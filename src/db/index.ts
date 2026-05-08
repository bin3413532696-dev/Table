import { financeStore, taskStore } from '../store/impl';
import { subscribeDataChange } from '../core/events';
import { AppError, ErrorCode, errorHandler } from '../core/errors';
import { isValidFinanceRecord, isValidTask } from '../core/validation';
import { FinanceRecord, Task } from '../core/types';
import { fetchAuthMe, fetchWithAuth, updateAuthMe } from '../lib/auth';
import { syncEngine } from '../sync';

export type { FinanceRecord, Task };

type ApiListResponse<T> = {
  items: T[];
  total: number;
  source: string;
};

type BusinessSnapshot = {
  version: number;
  exportedAt: string;
  tasks: Task[];
  finance: FinanceRecord[];
};

type ApiErrorResponse = {
  error?: string;
  message?: string;
};

async function parseApiError(response: Response, context: string): Promise<AppError> {
  let payload: ApiErrorResponse | null = null;

  try {
    payload = await response.json() as ApiErrorResponse;
  } catch {
    payload = null;
  }

  if (response.status === 400) {
    return AppError.fromCode(
      ErrorCode.VALIDATION_FAILED,
      payload?.message || context
    );
  }

  if (response.status === 404) {
    return AppError.fromCode(
      ErrorCode.ENTITY_NOT_FOUND,
      payload?.message || context
    );
  }

  return AppError.fromCode(
    ErrorCode.NETWORK_ERROR,
    payload?.message || `${context}: HTTP ${response.status}`
  );
}

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    const headers = new Headers(init?.headers);
    const hasBody = init?.body !== undefined && init?.body !== null;

    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    response = await fetchWithAuth(path, {
      ...init,
      headers,
    });
  } catch (error) {
    throw errorHandler.handle(error, path);
  }

  if (!response.ok) {
    throw errorHandler.handle(await parseApiError(response, path), path);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function requestApiData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestApi<{ data: T; source: string }>(path, init);
  return response.data;
}

function scheduleKnowledgeRefresh(): void {
  void syncEngine.loadKnowledgeFromServer()
    .then((result) => {
      if (result.success) {
        console.log('[DB] Knowledge data refreshed successfully');
      }
    })
    .catch((error) => {
      console.warn('[DB] Failed to refresh knowledge data:', error);
    });
}

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 10 && /^[a-z0-9-]+$/i.test(id);
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const hashedInput = await hashPin(pin);
  return hashedInput === hashedPin;
}

type CollectionType = 'finance' | 'tasks';
type Listener = (collection: CollectionType) => void;

export function subscribe(listener: Listener): () => void {
  const unsubFinance = subscribeDataChange('finance', () => listener('finance'));
  const unsubTasks = subscribeDataChange('tasks', () => listener('tasks'));

  return () => {
    unsubFinance();
    unsubTasks();
  };
}

let storageError: Error | null = null;
let storageQuotaExceeded = false;

function cloneFinanceData(): Promise<FinanceRecord[]> {
  return financeStore.getAll();
}

function cloneTaskData(): Promise<Task[]> {
  return taskStore.getAll();
}

async function hydrateFinanceCache(records: FinanceRecord[], emit = false): Promise<void> {
  financeStore.hydrate(records, emit);
}

async function hydrateTaskCache(tasks: Task[], emit = false): Promise<void> {
  taskStore.hydrate(tasks, emit);
}

export function getStorageError(): Error | null {
  return storageError;
}

export function isStorageQuotaExceeded(): boolean {
  return storageQuotaExceeded;
}

export function getStorageUsage(): { used: number; available: boolean } {
  try {
    const theme = localStorage.getItem('theme') || '';
    const notificationSettings = localStorage.getItem('notification_settings') || '';
    const used = new Blob([theme + notificationSettings]).size;
    return { used, available: true };
  } catch {
    return { used: 0, available: false };
  }
}

export const financeDB = {
  async getAll(): Promise<FinanceRecord[]> {
    const response = await requestApi<ApiListResponse<FinanceRecord>>('/api/finance');
    const records = response.items
      .filter(isValidFinanceRecord)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    await hydrateFinanceCache(records, false);
    return records;
  },

  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    const created = await requestApiData<FinanceRecord>('/api/finance', {
      method: 'POST',
      body: JSON.stringify({
        type: record.type,
        amount: Number(record.amount),
        description: record.description,
        category: record.category,
        date: record.date,
        model: record.model || undefined,
      }),
    });

    if (!isValidFinanceRecord(created)) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid finance payload from server'),
        'finance.add'
      );
    }

    const snapshot = await financeStore.getAll();
    const next = [created, ...snapshot.filter((item) => item.id !== created.id)]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    await hydrateFinanceCache(next, true);
    scheduleKnowledgeRefresh();
    return created;
  },

  async update(id: string, updates: Partial<FinanceRecord>): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (updates.type !== undefined) payload.type = updates.type;
    if (updates.amount !== undefined) payload.amount = Number(updates.amount);
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.date !== undefined) payload.date = updates.date;
    if (updates.model !== undefined) payload.model = updates.model;
    if (updates.version !== undefined) payload.version = updates.version;

    const updated = await requestApiData<FinanceRecord>(`/api/finance/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    if (!isValidFinanceRecord(updated)) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid finance payload from server'),
        'finance.update'
      );
    }

    const snapshot = await financeStore.getAll();
    const next = snapshot
      .map((item) => (item.id === id ? updated : item))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    await hydrateFinanceCache(next, true);
    scheduleKnowledgeRefresh();
  },

  async delete(id: string): Promise<void> {
    await requestApi<void>(`/api/finance/${id}`, {
      method: 'DELETE',
    });

    const snapshot = await financeStore.getAll();
    const next = snapshot.filter((item) => item.id !== id);
    await hydrateFinanceCache(next, true);
    scheduleKnowledgeRefresh();
  },

  async getStats() {
    const records = await financeStore.getAll();
    const income = records
      .filter(r => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0);
    const expense = records
      .filter(r => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      income,
      expense,
      profit: income - expense,
    };
  },

  async getModelStats(): Promise<Record<string, { expense: number; income: number }>> {
    const records = await financeStore.getAll();
    const stats: Record<string, { expense: number; income: number }> = {};

    records.forEach((record) => {
      const model = record.model || '其他';
      if (!stats[model]) {
        stats[model] = { expense: 0, income: 0 };
      }

      if (record.type === 'expense') {
        stats[model].expense += record.amount;
      } else {
        stats[model].income += record.amount;
      }
    });

    return stats;
  }
};

export const taskDB = {
  async getAll(): Promise<Task[]> {
    const response = await requestApi<ApiListResponse<Task>>('/api/tasks');
    const tasks = response.items
      .filter(isValidTask)
      .sort((a, b) => b.createdAt - a.createdAt);
    await hydrateTaskCache(tasks, false);
    return tasks;
  },

  async add(record: Omit<Task, 'id'>): Promise<Task> {
    const created = await requestApiData<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: record.title,
        completed: record.completed ?? false,
        priority: record.priority ?? 'medium',
        dueDate: record.dueDate,
      }),
    });

    if (!isValidTask(created)) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid task payload from server'),
        'task.add'
      );
    }

    const snapshot = await taskStore.getAll();
    const next = [created, ...snapshot.filter((item) => item.id !== created.id)]
      .sort((a, b) => b.createdAt - a.createdAt);
    await hydrateTaskCache(next, true);
    scheduleKnowledgeRefresh();
    return created;
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.completed !== undefined) payload.completed = updates.completed;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.dueDate !== undefined) payload.dueDate = updates.dueDate === '' ? null : updates.dueDate;
    if (updates.version !== undefined) payload.version = updates.version;

    const updated = await requestApiData<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    if (!isValidTask(updated)) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid task payload from server'),
        'task.update'
      );
    }

    const snapshot = await taskStore.getAll();
    const next = snapshot
      .map((item) => (item.id === id ? updated : item))
      .sort((a, b) => b.createdAt - a.createdAt);
    await hydrateTaskCache(next, true);
    scheduleKnowledgeRefresh();
  },

  async delete(id: string): Promise<void> {
    await requestApi<void>(`/api/tasks/${id}`, {
      method: 'DELETE',
    });

    const snapshot = await taskStore.getAll();
    const next = snapshot.filter((item) => item.id !== id);
    await hydrateTaskCache(next, true);
    scheduleKnowledgeRefresh();
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

    const updated = await requestApiData<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        completed: !task.completed,
        ...(task.version !== undefined ? { version: task.version } : {}),
      }),
    });

    if (!isValidTask(updated)) {
      throw errorHandler.handle(
        AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid task payload from server'),
        'task.toggle'
      );
    }

    const next = snapshot
      .map((item) => (item.id === id ? updated : item))
      .sort((a, b) => b.createdAt - a.createdAt);
    await hydrateTaskCache(next, true);
    scheduleKnowledgeRefresh();
  },

  async getStats() {
    const tasks = await taskStore.getAll();
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;

    return {
      total,
      completed,
      pending: total - completed,
    };
  }
};

export const dataManager = {
  async exportBusinessData(): Promise<string> {
    const snapshot = await requestApi<BusinessSnapshot>('/api/maintenance/business-snapshot');
    return JSON.stringify(snapshot, null, 2);
  },

  async exportKnowledgeData(): Promise<string> {
    const notes = await requestApi<ApiListResponse<{ id: string; title: string; content: string; tags: string[]; createdAt: number; updatedAt: number }>>('/api/knowledge/notes');
    const presetTags = await requestApi<ApiListResponse<{ id: string; name: string; color: string; sortOrder: number }>>('/api/knowledge/tags/preset');

    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      knowledge: {
        notes: notes.items,
        presetTags: presetTags.items,
      },
    }, null, 2);
  },

  async exportLocalSettings(): Promise<string> {
    const auth = await fetchAuthMe().catch(() => null);
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      userSettings: {
        profile: auth ? JSON.stringify({
          name: auth.data.user.displayName || '个人用户',
          email: auth.data.user.email || '',
          bio: auth.data.user.bio || '',
        }) : null,
        theme: localStorage.getItem('theme'),
        notificationSettings: localStorage.getItem('notification_settings'),
      },
    }, null, 2);
  },

  async importBusinessData(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      await requestApi('/api/maintenance/business-snapshot', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      await Promise.all([
        financeDB.getAll(),
        taskDB.getAll(),
      ]);
      scheduleKnowledgeRefresh();

      return true;
    } catch (error) {
      console.error('[DB] Business import failed:', error);
      return false;
    }
  },

  async importKnowledgeData(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      await requestApi('/api/maintenance/business-snapshot', {
        method: 'POST',
        body: JSON.stringify({
          knowledge: data.knowledge || data,
        }),
      });

      scheduleKnowledgeRefresh();
      return true;
    } catch (error) {
      console.error('[DB] Knowledge import failed:', error);
      return false;
    }
  },

  async importLocalSettings(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      const settings = data.userSettings && typeof data.userSettings === 'object'
        ? data.userSettings as Record<string, unknown>
        : data;

      if (typeof settings.profile === 'string') {
        try {
          const parsed = JSON.parse(settings.profile) as { name?: unknown; email?: unknown; bio?: unknown };
          await updateAuthMe({
            displayName: typeof parsed.name === 'string' ? parsed.name : '个人用户',
            email: typeof parsed.email === 'string' ? parsed.email : null,
            bio: typeof parsed.bio === 'string' ? parsed.bio : '',
          });
        } catch {
          // ignore invalid legacy profile payload
        }
      }
      if (typeof settings.theme === 'string') {
        localStorage.setItem('theme', settings.theme);
      }
      if (typeof settings.notificationSettings === 'string') {
        localStorage.setItem('notification_settings', settings.notificationSettings);
      }

      return true;
    } catch (error) {
      console.error('[DB] Local settings import failed:', error);
      return false;
    }
  },

  async clearKnowledgeData(): Promise<void> {
    await requestApi('/api/maintenance/reset', {
      method: 'POST',
      body: JSON.stringify({ scope: 'knowledge' }),
    });
  },

  clearLocalSettings(): void {
    localStorage.removeItem('theme');
    localStorage.removeItem('notification_settings');
    localStorage.removeItem('security_pin_hashed');
  },

  async clearAll(): Promise<void> {
    await requestApi<{ success: boolean; resetAt: string }>('/api/maintenance/reset', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await Promise.all([
      financeDB.getAll(),
      taskDB.getAll(),
    ]);
    scheduleKnowledgeRefresh();

    localStorage.removeItem('theme');
    localStorage.removeItem('notification_settings');
  },

  async getStats() {
    const [finance, tasks] = await Promise.all([
      financeStore.getAll(),
      taskStore.getAll(),
    ]);
    const knowledgeMeta = await requestApi<{ data: { noteCount: number; presetTagCount: number } }>('/api/knowledge/metadata');

    return {
      finance: finance.length,
      tasks: tasks.length,
      knowledgeNotes: knowledgeMeta.data?.noteCount || 0,
      knowledgePresetTags: knowledgeMeta.data?.presetTagCount || 0,
      totalSize: JSON.stringify({ finance, tasks }).length,
    };
  },

  getSyncStatus(): {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastError: string | null;
    retryCount: number;
    lastSuccessfulSync: string | null;
  } {
    const status = syncEngine.getStatus();
    return {
      status: status.status,
      lastError: status.lastError,
      retryCount: status.retryCount,
      lastSuccessfulSync: status.lastSuccessfulSync,
    };
  },

  async triggerSync(): Promise<{ success: boolean; error?: string }> {
    try {
      await Promise.all([
        financeDB.getAll(),
        taskDB.getAll(),
      ]);
      scheduleKnowledgeRefresh();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      };
    }
  },

};

export const initDB = async () => true;

export function createUseDB(React: typeof import('react')) {
  return function useDB<T>(
    fetcher: () => Promise<T>,
    dependencies: CollectionType[]
  ): { data: T | null; loading: boolean } {
    const [data, setData] = React.useState<T | null>(null);
    const [loading, setLoading] = React.useState(true);
    const fetcherRef = React.useRef(fetcher);
    const depsRef = React.useRef(dependencies);

    React.useEffect(() => {
      fetcherRef.current = fetcher;
    }, [fetcher]);

    React.useEffect(() => {
      depsRef.current = dependencies;
    }, [dependencies]);

    React.useEffect(() => {
      let ignore = false;

      const load = async () => {
        setLoading(true);
        try {
          const result = await fetcherRef.current();
          if (!ignore) setData(result);
        } catch (error) {
          console.error('useDB fetch error:', error);
        } finally {
          if (!ignore) setLoading(false);
        }
      };

      load();

      const unsubscribe = subscribe((collection) => {
        if (depsRef.current.includes(collection)) {
          load();
        }
      });

      return () => {
        ignore = true;
        unsubscribe();
      };
    }, []);

    return { data, loading };
  };
}