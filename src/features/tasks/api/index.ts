import { AppError, ErrorCode, errorHandler } from '../../../core/errors';
import type { Task } from '../../../core/types';
import { isValidTask } from '../../../core/validation';
import { taskStore } from '../store';
import { syncEngine } from '../../knowledge/public';
import { ApiListResponse, requestApi, requestApiData } from '../../../shared/api/client';

async function refreshKnowledgeCache(): Promise<void> {
  const result = await syncEngine.loadKnowledgeFromServer();

  if (!result.success) {
    console.warn('[Tasks API] Failed to refresh knowledge cache:', result.error);
  }
}

function sortTasks(items: Task[]): Task[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeTaskPayload(task: unknown): unknown {
  if (typeof task !== 'object' || task === null) {
    return task;
  }

  const record = task as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...record };

  if (normalized.dueDate === null) {
    delete normalized.dueDate;
  }

  if (normalized.notes === null) {
    delete normalized.notes;
  }

  return normalized;
}

function assertValidTask(task: unknown, context: string): Task {
  const normalizedTask = normalizeTaskPayload(task);

  if (!isValidTask(normalizedTask)) {
    throw errorHandler.handle(
      AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid task payload from server'),
      context
    );
  }

  return normalizedTask;
}

async function loadTasks(emit = false): Promise<Task[]> {
  const response = await requestApi<ApiListResponse<Task>>('/api/tasks/');
  const tasks = sortTasks(
    response.items
      .map((item) => normalizeTaskPayload(item))
      .filter(isValidTask)
  );

  taskStore.hydrate(tasks, emit);
  return tasks;
}

export const taskApi = {
  async getAll(): Promise<Task[]> {
    return loadTasks(false);
  },

  async refresh(): Promise<Task[]> {
    return loadTasks(true);
  },

  async add(record: Omit<Task, 'id'>): Promise<Task> {
    const created = assertValidTask(
      await requestApiData<Task>('/api/tasks/', {
        method: 'POST',
        body: JSON.stringify({
          title: record.title,
          completed: record.completed ?? false,
          priority: record.priority ?? 'medium',
          dueDate: record.dueDate,
        }),
      }),
      'task.add'
    );

    const snapshot = await taskStore.getAll();
    const next = sortTasks([created, ...snapshot.filter((item) => item.id !== created.id)]);
    taskStore.hydrate(next, true);
    void refreshKnowledgeCache();
    return created;
  },

  async update(id: string, updates: Partial<Task> & { version: number }): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.completed !== undefined) payload.completed = updates.completed;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.dueDate !== undefined) payload.dueDate = updates.dueDate === '' ? null : updates.dueDate;
    if (updates.version !== undefined) payload.version = updates.version;

    const updated = assertValidTask(
      await requestApiData<Task>(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
      'task.update'
    );

    const snapshot = await taskStore.getAll();
    const next = sortTasks(snapshot.map((item) => (item.id === id ? updated : item)));
    taskStore.hydrate(next, true);
    void refreshKnowledgeCache();
  },

  async delete(id: string): Promise<void> {
    await requestApi<void>(`/api/tasks/${id}`, {
      method: 'DELETE',
    });

    const snapshot = await taskStore.getAll();
    taskStore.hydrate(snapshot.filter((item) => item.id !== id), true);
    void refreshKnowledgeCache();
  },

  async toggle(id: string): Promise<void> {
    const snapshot = await taskStore.getAll();
    const task = snapshot.find((item) => item.id === id);

    if (!task) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id),
        'task.toggle'
      );
    }

    const updated = assertValidTask(
      await requestApiData<Task>(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          completed: !task.completed,
          ...(task.version !== undefined ? { version: task.version } : {}),
        }),
      }),
      'task.toggle'
    );

    const next = sortTasks(snapshot.map((item) => (item.id === id ? updated : item)));
    taskStore.hydrate(next, true);
    void refreshKnowledgeCache();
  },

  async getStats(): Promise<{ total: number; completed: number; pending: number }> {
    const tasks = await taskStore.getAll();
    const total = tasks.length;
    const completed = tasks.filter((task) => task.completed).length;

    return {
      total,
      completed,
      pending: total - completed,
    };
  },
};
