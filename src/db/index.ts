import { financeStore, taskStore } from '../store/impl';
import { subscribeDataChange } from '../core/events';
import { AppError, ErrorCode, errorHandler } from '../core/errors';
import { isValidFinanceRecord, isValidTask } from '../core/validation';
import { FinanceRecord, Task } from '../core/types';
import { getKnowledgeDataset, hydrateKnowledgeDataset } from '../kb';
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
    response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
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

function scheduleKnowledgeRefresh(): void {
  void syncEngine.loadKnowledgeFromServer()
    .then(async (result) => {
      if (result.success && result.data?.knowledge !== undefined) {
        await hydrateKnowledgeDataset(result.data.knowledge);
      }
    })
    .catch((error) => {
      console.warn('[DB] Failed to refresh knowledge projection snapshot:', error);
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
    const financeData = localStorage.getItem('finance_records') || '';
    const tasksData = localStorage.getItem('tasks_records') || '';
    const used = new Blob([financeData + tasksData]).size;
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
    const created = await requestApi<FinanceRecord>('/api/finance', {
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

    const updated = await requestApi<FinanceRecord>(`/api/finance/${id}`, {
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
    const created = await requestApi<Task>('/api/tasks', {
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

    const updated = await requestApi<Task>(`/api/tasks/${id}`, {
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

    const updated = await requestApi<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        completed: !task.completed,
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
    const result = await requestApi<{
      success: boolean;
      data?: {
        knowledge?: unknown;
      };
    }>('/api/load-data');

    const knowledge = result.data?.knowledge !== undefined
      ? result.data.knowledge
      : getKnowledgeDataset();

    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      knowledge,
    }, null, 2);
  },

  async exportLocalSettings(): Promise<string> {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      userSettings: {
        profile: localStorage.getItem('user_profile'),
        theme: localStorage.getItem('theme'),
        notificationSettings: localStorage.getItem('notification_settings'),
        securityPin: localStorage.getItem('security_pin_hashed'),
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
      const knowledge = data.knowledge !== undefined ? data.knowledge : data;
      await hydrateKnowledgeDataset(knowledge);
      const syncResult = await syncEngine.syncNow();
      if (!syncResult.success) {
        throw new Error(syncResult.error || 'Unknown sync error');
      }
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
        localStorage.setItem('user_profile', settings.profile);
      }
      if (typeof settings.theme === 'string') {
        localStorage.setItem('theme', settings.theme);
      }
      if (typeof settings.notificationSettings === 'string') {
        localStorage.setItem('notification_settings', settings.notificationSettings);
      }
      if (typeof settings.securityPin === 'string') {
        localStorage.setItem('security_pin_hashed', settings.securityPin);
      }

      return true;
    } catch (error) {
      console.error('[DB] Local settings import failed:', error);
      return false;
    }
  },

  async clearKnowledgeData(): Promise<void> {
    await hydrateKnowledgeDataset({
      ...getKnowledgeDataset(),
      entities: [],
      documents: [],
      assertions: [],
      updatedAt: Date.now(),
    });

    const syncResult = await syncEngine.syncNow();
    if (!syncResult.success) {
      throw new Error(syncResult.error || 'Unknown clear error');
    }
  },

  clearLocalSettings(): void {
    localStorage.removeItem('user_profile');
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

    await hydrateKnowledgeDataset({
      ...getKnowledgeDataset(),
      entities: [],
      documents: [],
      assertions: [],
      updatedAt: Date.now(),
    });
    localStorage.removeItem('user_profile');
    localStorage.removeItem('theme');
    localStorage.removeItem('notification_settings');
    localStorage.removeItem('security_pin_hashed');

    const syncResult = await syncEngine.syncNow();
    if (!syncResult.success) {
      throw new Error(syncResult.error || 'Unknown clear error');
    }
  },

  async getStats() {
    const [finance, tasks] = await Promise.all([
      financeStore.getAll(),
      taskStore.getAll(),
    ]);
    const knowledge = getKnowledgeDataset();

    return {
      finance: finance.length,
      tasks: tasks.length,
      knowledgeEntities: knowledge.entities.length,
      knowledgeDocuments: knowledge.documents.length,
      knowledgeAssertions: knowledge.assertions.length,
      totalSize: JSON.stringify({ finance, tasks, knowledge }).length,
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
      const result = await syncEngine.syncNow();
      return result.success
        ? { success: true }
        : { success: false, error: result.error || 'Unknown sync error' };
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
