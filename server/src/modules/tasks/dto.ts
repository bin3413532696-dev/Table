import type { Task } from '@prisma/client';

function toTimestamp(value: Date): number {
  return value.getTime();
}

function toDateOnly(value: Date | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.toISOString().slice(0, 10);
}

export function toTaskDto(task: Task) {
  return {
    id: task.id,
    title: task.title,
    completed: task.completed,
    priority: task.priority as 'low' | 'medium' | 'high',
    dueDate: toDateOnly(task.dueDate),
    notes: task.notes ?? undefined,
    createdAt: toTimestamp(task.createdAt),
    updatedAt: toTimestamp(task.updatedAt),
  };
}
