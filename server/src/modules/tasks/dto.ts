import type { Task } from '@prisma/client';
import { toTimestamp, toDateOnly } from '../../shared/date';

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
    version: task.version,
  };
}
