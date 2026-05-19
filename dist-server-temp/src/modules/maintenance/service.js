"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportBusinessSnapshot = exportBusinessSnapshot;
exports.importBusinessSnapshot = importBusinessSnapshot;
exports.resetWorkspaceData = resetWorkspaceData;
const client_1 = require("../../db/client");
const user_context_1 = require("../../shared/user-context");
const dto_1 = require("./dto");
function normalizeImportedNotes(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }
        const record = item;
        return (typeof record.title === 'string' &&
            record.title.trim().length > 0);
    });
}
function normalizeImportedPresetTags(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }
        const record = item;
        return (typeof record.name === 'string' &&
            record.name.trim().length > 0);
    });
}
function normalizeImportedKnowledge(value) {
    if (!value || typeof value !== 'object') {
        return { notes: [], presetTags: [] };
    }
    const knowledge = value;
    return {
        notes: normalizeImportedNotes(knowledge.notes),
        presetTags: normalizeImportedPresetTags(knowledge.presetTags),
    };
}
function isValidPriority(value) {
    return value === 'low' || value === 'medium' || value === 'high';
}
function isValidFinanceType(value) {
    return value === 'income' || value === 'expense';
}
function isFiniteTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function normalizeImportedTasks(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }
        const record = item;
        return (typeof record.title === 'string' &&
            record.title.trim().length > 0 &&
            typeof record.completed === 'boolean' &&
            isValidPriority(record.priority));
    });
}
function normalizeImportedFinance(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }
        const record = item;
        return (isValidFinanceType(record.type) &&
            typeof record.amount === 'number' &&
            Number.isFinite(record.amount) &&
            record.amount >= 0 &&
            typeof record.description === 'string' &&
            record.description.trim().length > 0 &&
            typeof record.category === 'string' &&
            record.category.trim().length > 0 &&
            typeof record.date === 'string' &&
            record.date.trim().length > 0);
    });
}
function toOptionalDate(value) {
    return value ? new Date(value) : null;
}
function toTimestampDate(value) {
    return isFiniteTimestamp(value) ? new Date(value) : new Date();
}
async function exportBusinessSnapshot() {
    const userId = (0, user_context_1.getCurrentUserId)();
    const [tasks, finance, notes, presetTags] = await Promise.all([
        client_1.prisma.task.findMany({
            where: {
                userId,
                deletedAt: null,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        }),
        client_1.prisma.financeRecord.findMany({
            where: {
                userId,
                deletedAt: null,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        }),
        client_1.prisma.knowledgeNote.findMany({
            where: {
                userId,
                deletedAt: null,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        }),
        client_1.prisma.knowledgePresetTag.findMany({
            where: {
                userId,
            },
            orderBy: {
                sortOrder: 'asc',
            },
        }),
    ]);
    return (0, dto_1.toBusinessSnapshotDto)({
        tasks,
        finance,
        notes,
        presetTags,
    });
}
async function importBusinessSnapshot(payload) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const source = payload && typeof payload === 'object'
        ? payload
        : {};
    const tasks = normalizeImportedTasks(source.tasks);
    const finance = normalizeImportedFinance(source.finance);
    const knowledge = normalizeImportedKnowledge(source.knowledge);
    if (tasks.length === 0 && finance.length === 0
        && knowledge.notes.length === 0 && knowledge.presetTags.length === 0) {
        throw new Error('Cannot import empty snapshot');
    }
    const backup = await exportBusinessSnapshot();
    await client_1.prisma.$transaction(async (tx) => {
        await tx.task.deleteMany({
            where: {
                userId,
            },
        });
        await tx.financeRecord.deleteMany({
            where: {
                userId,
            },
        });
        await tx.knowledgeNote.deleteMany({
            where: { userId },
        });
        await tx.knowledgePresetTag.deleteMany({
            where: { userId },
        });
        if (tasks.length > 0) {
            const createdAt = Date.now();
            await tx.task.createMany({
                data: tasks.map((task, index) => ({
                    userId,
                    title: task.title.trim(),
                    completed: task.completed ?? false,
                    priority: task.priority ?? 'medium',
                    dueDate: toOptionalDate(task.dueDate),
                    notes: typeof task.notes === 'string' ? task.notes : null,
                    createdAt: toTimestampDate(task.createdAt ?? createdAt + index),
                    updatedAt: toTimestampDate(task.updatedAt ?? createdAt + index),
                })),
            });
        }
        if (finance.length > 0) {
            const createdAt = Date.now();
            await tx.financeRecord.createMany({
                data: finance.map((record, index) => ({
                    userId,
                    type: record.type,
                    amount: record.amount,
                    category: record.category.trim(),
                    description: record.description.trim(),
                    recordDate: new Date(record.date),
                    model: typeof record.model === 'string' && record.model.trim().length > 0 ? record.model : null,
                    metadataJson: {},
                    createdAt: toTimestampDate(record.createdAt ?? createdAt + index),
                    updatedAt: toTimestampDate(record.updatedAt ?? createdAt + index),
                })),
            });
        }
        if (knowledge.notes.length > 0) {
            const createdAt = Date.now();
            await tx.knowledgeNote.createMany({
                data: knowledge.notes.map((note, index) => ({
                    userId,
                    title: note.title.trim(),
                    content: typeof note.content === 'string' ? note.content : '',
                    tagsJson: Array.isArray(note.tags)
                        ? note.tags.filter((tag) => typeof tag === 'string')
                        : [],
                    createdAt: toTimestampDate(note.createdAt ?? createdAt + index),
                    updatedAt: toTimestampDate(note.updatedAt ?? createdAt + index),
                })),
            });
        }
        if (knowledge.presetTags.length > 0) {
            await tx.knowledgePresetTag.createMany({
                data: knowledge.presetTags.map((tag, index) => ({
                    userId,
                    name: tag.name.trim(),
                    color: typeof tag.color === 'string' && tag.color.trim().length > 0 ? tag.color.trim() : '#6B7280',
                    sortOrder: typeof tag.sortOrder === 'number' ? tag.sortOrder : index,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })),
            });
        }
    });
    return {
        success: true,
        importedAt: new Date().toISOString(),
        backup,
        tasks: tasks.length,
        finance: finance.length,
        notes: knowledge.notes.length,
        presetTags: knowledge.presetTags.length,
    };
}
async function resetWorkspaceData(scope = 'all') {
    const userId = (0, user_context_1.getCurrentUserId)();
    const shouldResetTasks = scope === 'all' || scope === 'tasks';
    const shouldResetFinance = scope === 'all' || scope === 'finance';
    const shouldResetKnowledge = scope === 'all' || scope === 'knowledge';
    await client_1.prisma.$transaction(async (tx) => {
        if (shouldResetTasks) {
            await tx.task.updateMany({
                where: { userId },
                data: { deletedAt: new Date() },
            });
        }
        if (shouldResetFinance) {
            await tx.financeRecord.updateMany({
                where: { userId },
                data: { deletedAt: new Date() },
            });
        }
        if (shouldResetKnowledge) {
            await tx.knowledgeNote.updateMany({
                where: { userId },
                data: { deletedAt: new Date() },
            });
            await tx.knowledgePresetTag.deleteMany({
                where: { userId },
            });
        }
        if (shouldResetTasks) {
            await tx.task.createMany({
                data: [
                    {
                        userId,
                        title: '梳理存储层改造边界',
                        completed: false,
                        priority: 'high',
                        dueDate: new Date('2026-05-10'),
                        notes: '明确前后端职责与迁移路径',
                    },
                    {
                        userId,
                        title: '落地 PostgreSQL 权威写路径',
                        completed: true,
                        priority: 'medium',
                        dueDate: new Date('2026-05-03'),
                        notes: '第一阶段基础能力',
                    },
                ],
            });
        }
        if (shouldResetFinance) {
            await tx.financeRecord.createMany({
                data: [
                    {
                        userId,
                        type: 'expense',
                        amount: 299.0,
                        category: 'infrastructure',
                        description: 'PostgreSQL 环境准备',
                        recordDate: new Date('2026-05-04'),
                        model: 'backend',
                        metadataJson: {},
                    },
                    {
                        userId,
                        type: 'income',
                        amount: 1200.0,
                        category: 'project',
                        description: '阶段性项目结算',
                        recordDate: new Date('2026-05-01'),
                        model: 'delivery',
                        metadataJson: {},
                    },
                ],
            });
        }
        if (shouldResetKnowledge) {
            await tx.knowledgeNote.createMany({
                data: [
                    {
                        userId,
                        title: '系统架构设计笔记',
                        content: '采用 Fastify + Prisma + PostgreSQL 的后端架构',
                        tagsJson: ['architecture', 'backend'],
                    },
                ],
            });
            await tx.knowledgePresetTag.createMany({
                data: [
                    {
                        userId,
                        name: 'architecture',
                        color: '#3B82F6',
                        sortOrder: 0,
                    },
                    {
                        userId,
                        name: 'backend',
                        color: '#10B981',
                        sortOrder: 1,
                    },
                    {
                        userId,
                        name: 'frontend',
                        color: '#F59E0B',
                        sortOrder: 2,
                    },
                    {
                        userId,
                        name: 'design',
                        color: '#EF4444',
                        sortOrder: 3,
                    },
                ],
            });
        }
    });
    return {
        success: true,
        scope,
        resetAt: new Date().toISOString(),
    };
}
