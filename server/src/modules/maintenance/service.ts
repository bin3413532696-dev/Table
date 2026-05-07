import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import { toBusinessSnapshotDto } from './dto';

type ImportedTask = {
  title?: string;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
  notes?: string;
  createdAt?: number;
  updatedAt?: number;
};

type ImportedFinance = {
  type?: 'income' | 'expense';
  amount?: number;
  description?: string;
  category?: string;
  date?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
};

function isValidPriority(value: unknown): value is 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isValidFinanceType(value: unknown): value is 'income' | 'expense' {
  return value === 'income' || value === 'expense';
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeImportedTasks(value: unknown): ImportedTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ImportedTask => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as ImportedTask;
    return (
      typeof record.title === 'string' &&
      record.title.trim().length > 0 &&
      typeof record.completed === 'boolean' &&
      isValidPriority(record.priority)
    );
  });
}

function normalizeImportedFinance(value: unknown): ImportedFinance[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ImportedFinance => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as ImportedFinance;
    return (
      isValidFinanceType(record.type) &&
      typeof record.amount === 'number' &&
      Number.isFinite(record.amount) &&
      record.amount >= 0 &&
      typeof record.description === 'string' &&
      record.description.trim().length > 0 &&
      typeof record.category === 'string' &&
      record.category.trim().length > 0 &&
      typeof record.date === 'string' &&
      record.date.trim().length > 0
    );
  });
}

function toOptionalDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

function toTimestampDate(value?: number): Date {
  return isFiniteTimestamp(value) ? new Date(value) : new Date();
}

export async function exportBusinessSnapshot() {
  const userId = getCurrentUserId();

  const [tasks, finance] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
    prisma.financeRecord.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
  ]);

  return toBusinessSnapshotDto({
    tasks,
    finance,
  });
}

export async function importBusinessSnapshot(payload: unknown) {
  const userId = getCurrentUserId();
  const source = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};

  const tasks = normalizeImportedTasks(source.tasks);
  const finance = normalizeImportedFinance(source.finance);

  await prisma.$transaction(async (tx) => {
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

    if (tasks.length > 0) {
      const createdAt = Date.now();
      await tx.task.createMany({
        data: tasks.map((task, index) => ({
          userId,
          title: task.title!.trim(),
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
          type: record.type!,
          amount: record.amount!,
          category: record.category!.trim(),
          description: record.description!.trim(),
          recordDate: new Date(record.date!),
          model: typeof record.model === 'string' && record.model.trim().length > 0 ? record.model : null,
          metadataJson: {},
          createdAt: toTimestampDate(record.createdAt ?? createdAt + index),
          updatedAt: toTimestampDate(record.updatedAt ?? createdAt + index),
        })),
      });
    }
  });

  return {
    success: true,
    importedAt: new Date().toISOString(),
    tasks: tasks.length,
    finance: finance.length,
  };
}

export async function resetWorkspaceData() {
  const userId = getCurrentUserId();

  await prisma.$transaction(async (tx) => {
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
      where: {
        userId,
      },
    });

    await tx.knowledgePresetTag.deleteMany({
      where: {
        userId,
      },
    });

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
  });

  return {
    success: true,
    resetAt: new Date().toISOString(),
  };
}