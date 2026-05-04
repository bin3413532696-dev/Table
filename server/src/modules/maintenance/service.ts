import { prisma } from '../../db/client';
import { toBusinessSnapshotDto } from './dto';
import { createDefaultKnowledgeDataset } from '../knowledge/dataset';
import { replaceKnowledgeDataset } from '../knowledge/repository';
import {
  DEFAULT_USER_ID as PROJECTION_DEFAULT_USER_ID,
  enqueueProjectionOutboxEvents,
  KNOWLEDGE_PROJECTION_TOPIC,
  toProjectionPayload,
} from '../projection/outbox';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

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

function buildTaskKnowledgeProjectionPayload(task: ImportedTask & { id: string; createdAt?: number; updatedAt?: number }) {
  return {
    id: task.id,
    title: task.title!.trim(),
    completed: task.completed ?? false,
    priority: task.priority ?? 'medium',
    dueDate: task.dueDate,
    notes: typeof task.notes === 'string' ? task.notes : undefined,
    createdAt: isFiniteTimestamp(task.createdAt) ? task.createdAt : Date.now(),
    updatedAt: isFiniteTimestamp(task.updatedAt) ? task.updatedAt : Date.now(),
  };
}

function buildFinanceKnowledgeProjectionPayload(
  record: ImportedFinance & { id: string; createdAt?: number; updatedAt?: number }
) {
  return {
    id: record.id,
    type: record.type!,
    amount: record.amount!,
    description: record.description!.trim(),
    category: record.category!.trim(),
    date: record.date!,
    model: typeof record.model === 'string' && record.model.trim().length > 0 ? record.model : undefined,
    createdAt: isFiniteTimestamp(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: isFiniteTimestamp(record.updatedAt) ? record.updatedAt : Date.now(),
  };
}

export async function exportBusinessSnapshot() {
  const [tasks, finance] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
    prisma.financeRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
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
  const source = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};

  const tasks = normalizeImportedTasks(source.tasks);
  const finance = normalizeImportedFinance(source.finance);

  await prisma.$transaction(async (tx) => {
    await tx.task.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.financeRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.projectionOutboxEvent.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    if (tasks.length > 0) {
      const createdAt = Date.now();
      await tx.task.createMany({
        data: tasks.map((task, index) => ({
          userId: DEFAULT_USER_ID,
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
          userId: DEFAULT_USER_ID,
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

    const persistedTasks = await tx.task.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        deletedAt: null,
      },
    });
    const persistedFinance = await tx.financeRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        deletedAt: null,
      },
    });

    await enqueueProjectionOutboxEvents(tx, [
      ...persistedTasks.map((task) => ({
        userId: PROJECTION_DEFAULT_USER_ID,
        topic: KNOWLEDGE_PROJECTION_TOPIC,
        aggregateType: 'task',
        aggregateId: task.id,
        operation: 'upsert',
        payload: toProjectionPayload({
          id: task.id,
          title: task.title,
          completed: task.completed,
          priority: task.priority,
          dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined,
          notes: task.notes ?? undefined,
          createdAt: task.createdAt.getTime(),
          updatedAt: task.updatedAt.getTime(),
        }),
      })),
      ...persistedFinance.map((record) => ({
        userId: PROJECTION_DEFAULT_USER_ID,
        topic: KNOWLEDGE_PROJECTION_TOPIC,
        aggregateType: 'finance-record',
        aggregateId: record.id,
        operation: 'upsert',
        payload: toProjectionPayload({
          id: record.id,
          type: record.type,
          amount: Number(record.amount),
          description: record.description,
          category: record.category,
          date: record.recordDate.toISOString().slice(0, 10),
          model: record.model ?? undefined,
          createdAt: record.createdAt.getTime(),
          updatedAt: record.updatedAt.getTime(),
        }),
      })),
    ]);
  });

  return {
    success: true,
    importedAt: new Date().toISOString(),
    tasks: tasks.length,
    finance: finance.length,
  };
}

export async function resetWorkspaceData() {
  const knowledgeDataset = createDefaultKnowledgeDataset();

  await prisma.$transaction(async (tx) => {
    await tx.task.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.financeRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.projectionOutboxEvent.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeAssertionEvidenceLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeDocumentEntityLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeRelationRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeAssertionRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeOntologyRelationRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeOntologyClassRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeDocumentRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeEntityRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.knowledgeBase.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
      },
    });

    await tx.task.createMany({
      data: [
        {
          userId: DEFAULT_USER_ID,
          title: '梳理存储层改造边界',
          completed: false,
          priority: 'high',
          dueDate: new Date('2026-05-10'),
          notes: '明确前后端职责与迁移路径',
        },
        {
          userId: DEFAULT_USER_ID,
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
          userId: DEFAULT_USER_ID,
          type: 'expense',
          amount: 299.0,
          category: 'infrastructure',
          description: 'PostgreSQL 环境准备',
          recordDate: new Date('2026-05-04'),
          model: 'backend',
          metadataJson: {},
        },
        {
          userId: DEFAULT_USER_ID,
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

    const tasks = await tx.task.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        deletedAt: null,
      },
    });
    const financeRecords = await tx.financeRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        deletedAt: null,
      },
    });

    await enqueueProjectionOutboxEvents(tx, [
      ...tasks.map((task) => ({
        userId: PROJECTION_DEFAULT_USER_ID,
        topic: KNOWLEDGE_PROJECTION_TOPIC,
        aggregateType: 'task',
        aggregateId: task.id,
        operation: 'upsert',
        payload: toProjectionPayload({
          id: task.id,
          title: task.title,
          completed: task.completed,
          priority: task.priority,
          dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined,
          notes: task.notes ?? undefined,
          createdAt: task.createdAt.getTime(),
          updatedAt: task.updatedAt.getTime(),
        }),
      })),
      ...financeRecords.map((record) => ({
        userId: PROJECTION_DEFAULT_USER_ID,
        topic: KNOWLEDGE_PROJECTION_TOPIC,
        aggregateType: 'finance-record',
        aggregateId: record.id,
        operation: 'upsert',
        payload: toProjectionPayload({
          id: record.id,
          type: record.type,
          amount: Number(record.amount),
          description: record.description,
          category: record.category,
          date: record.recordDate.toISOString().slice(0, 10),
          model: record.model ?? undefined,
          createdAt: record.createdAt.getTime(),
          updatedAt: record.updatedAt.getTime(),
        }),
      })),
    ]);

  });

  await replaceKnowledgeDataset(knowledgeDataset);

  return {
    success: true,
    resetAt: new Date().toISOString(),
  };
}
