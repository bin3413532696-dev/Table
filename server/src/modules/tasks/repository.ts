import { prisma } from '../../db/client';
import type { CreateTaskInput, UpdateTaskInput } from './schema';
import {
  enqueueProjectionOutboxEvent,
  KNOWLEDGE_PROJECTION_TOPIC,
  toProjectionPayload,
} from '../projection/outbox';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

function toTaskProjectionPayload(task: {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    title: task.title,
    completed: task.completed,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined,
    notes: task.notes ?? undefined,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  };
}

export async function listTasks() {
  return prisma.task.findMany({
    where: {
      userId: DEFAULT_USER_ID,
      deletedAt: null,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
}

export async function createTask(input: CreateTaskInput) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        userId: DEFAULT_USER_ID,
        title: input.title,
        completed: input.completed ?? false,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes,
      },
    });

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'task',
      aggregateId: task.id,
      operation: 'upsert',
      payload: toProjectionPayload(toTaskProjectionPayload(task)),
    });

    return task;
  });
}

export async function findTaskById(id: string) {
  return prisma.task.findFirst({
    where: {
      id,
      userId: DEFAULT_USER_ID,
      deletedAt: null,
    },
  });
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
        version: {
          increment: 1,
        },
      },
    });

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'task',
      aggregateId: task.id,
      operation: 'upsert',
      payload: toProjectionPayload(toTaskProjectionPayload(task)),
    });

    return task;
  });
}

export async function softDeleteTask(id: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        version: {
          increment: 1,
        },
      },
    });

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'task',
      aggregateId: task.id,
      operation: 'delete',
      payload: toProjectionPayload({
        id: task.id,
      }),
    });

    return task;
  });
}
