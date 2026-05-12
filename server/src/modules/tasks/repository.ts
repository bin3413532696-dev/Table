import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateTaskInput, UpdateTaskInput } from './schema';

export async function listTasks() {
  return prisma.task.findMany({
    where: {
      userId: getCurrentUserId(),
      deletedAt: null,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
}

export async function createTask(input: CreateTaskInput) {
  return prisma.task.create({
    data: {
      userId: getCurrentUserId(),
      title: input.title,
      completed: input.completed ?? false,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes,
    },
  });
}

export async function findTaskById(id: string) {
  return prisma.task.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
      deletedAt: null,
    },
  });
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  return prisma.task.updateManyAndReturn({
    where: {
      id,
      userId: getCurrentUserId(),
      deletedAt: null,
      version: input.version,
    },
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
  }).then((tasks) => tasks[0] ?? null);
}

export async function softDeleteTask(id: string) {
  return prisma.task.update({
    where: { id, userId: getCurrentUserId() },
    data: {
      deletedAt: new Date(),
      version: {
        increment: 1,
      },
    },
  });
}
