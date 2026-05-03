/**
 * 数据库兼容层
 * 保持向后兼容，内部使用新 Store 实现
 *
 * @deprecated 请使用 src/store 中的新 API
 * - import { financeStore, taskStore } from '@/store'
 * - import { useFinance, useTasks } from '@/store'
 */

import { financeStore, taskStore } from '../store/impl';
import { subscribeDataChange, eventEmitter } from '../core/events';
import { FinanceRecord, Task } from '../core/types';

// ============================================================================
// 类型导出（保持兼容）
// ============================================================================

export type { FinanceRecord, Task };

// ============================================================================
// 工具函数（保持兼容）
// ============================================================================

/**
 * @deprecated 使用 core/validation 中的 isValidId
 */
function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 10 && /^[a-z0-9-]+$/i.test(id);
}

/**
 * @deprecated 使用 core/validation 中的 isValidISODate
 */
function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 哈希 PIN
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证 PIN
 */
export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const hashedInput = await hashPin(pin);
  return hashedInput === hashedPin;
}

// ============================================================================
// 订阅系统（保持兼容）
// ============================================================================

type CollectionType = 'finance' | 'tasks';
type Listener = (collection: CollectionType) => void;

/**
 * @deprecated 使用 core/events 中的 subscribeDataChange
 */
export function subscribe(listener: Listener): () => void {
  const unsubFinance = subscribeDataChange('finance', () => listener('finance'));
  const unsubTasks = subscribeDataChange('tasks', () => listener('tasks'));

  return () => {
    unsubFinance();
    unsubTasks();
  };
}

// ============================================================================
// 存储状态（保持兼容）
// ============================================================================

let storageError: Error | null = null;
let storageQuotaExceeded: boolean = false;

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

// ============================================================================
// 同步状态（保持兼容）
// ============================================================================

let syncStatus: 'idle' | 'syncing' | 'success' | 'error' = 'idle';
let lastSyncError: Error | null = null;
let syncRetryCount = 0;
let lastSuccessfulSync: string | null = null;

// ============================================================================
// 财务数据库 API（保持兼容）
// ============================================================================

export const financeDB = {
  async getAll(): Promise<FinanceRecord[]> {
    const records = await financeStore.getAll();
    return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  /**
   * @deprecated 使用 financeStore.create()
   */
  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    const result = await financeStore.create(record);
    if (!result.success || !result.data) {
      throw new Error('Failed to create finance record');
    }
    return result.data;
  },

  async update(id: string, updates: Partial<FinanceRecord>): Promise<void> {
    await financeStore.update(id, updates);
  },

  async delete(id: string): Promise<void> {
    await financeStore.delete(id);
  },

  async getStats() {
    return financeStore.getStats();
  },

  async getModelStats(): Promise<Record<string, { expense: number; income: number }>> {
    return financeStore.getModelStats();
  }
};

// ============================================================================
// 任务数据库 API（保持兼容）
// ============================================================================

export const taskDB = {
  async getAll(): Promise<Task[]> {
    const records = await taskStore.getAll();
    return records.sort((a, b) => b.createdAt - a.createdAt);
  },

  /**
   * @deprecated 使用 taskStore.create()
   */
  async add(record: Omit<Task, 'id'>): Promise<Task> {
    const result = await taskStore.create({
      ...record,
      dueDate: record.dueDate
    });
    if (!result.success || !result.data) {
      throw new Error('Failed to create task');
    }
    return result.data;
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    const updateData: Partial<Task> = { ...updates };
    await taskStore.update(id, updateData);
  },

  async delete(id: string): Promise<void> {
    await taskStore.delete(id);
  },

  async toggle(id: string): Promise<void> {
    await taskStore.toggle(id);
  },

  async getStats() {
    return taskStore.getStats();
  }
};

// ============================================================================
// 数据管理器（保持兼容）
// ============================================================================

export const dataManager = {
  exportAll(): string {
    const data = {
      version: 2,
      finance: financeStore.getAll(),
      tasks: taskStore.getAll(),
      userSettings: {
        profile: localStorage.getItem('user_profile'),
        theme: localStorage.getItem('theme'),
        notificationSettings: localStorage.getItem('notification_settings'),
        securityPin: localStorage.getItem('security_pin_hashed'),
      },
      exportTime: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  },

  importAll(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);

      // 导入财务数据
      if (Array.isArray(data.finance)) {
        const validRecords = data.finance.filter((r: any): r is FinanceRecord => {
          return isValidId(r.id) &&
                 (r.type === 'income' || r.type === 'expense') &&
                 typeof r.amount === 'number';
        });
        // 使用新 Store 的批量导入
        financeStore.replaceAll(validRecords);
      }

      // 导入任务数据
      if (Array.isArray(data.tasks)) {
        const validRecords = data.tasks.filter((r: any): r is Task => {
          return isValidId(r.id) &&
                 typeof r.title === 'string' &&
                 typeof r.completed === 'boolean';
        });
        taskStore.replaceAll(validRecords);
      }

      // 导入用户设置
      if (data.userSettings) {
        if (data.userSettings.profile) {
          localStorage.setItem('user_profile', data.userSettings.profile);
        }
        if (data.userSettings.theme) {
          localStorage.setItem('theme', data.userSettings.theme);
        }
        if (data.userSettings.notificationSettings) {
          localStorage.setItem('notification_settings', data.userSettings.notificationSettings);
        }
        if (data.userSettings.securityPin) {
          localStorage.setItem('security_pin_hashed', data.userSettings.securityPin);
        }
      }

      return true;
    } catch (error) {
      console.error('[DB] Import failed:', error);
      return false;
    }
  },

  clearAll(): void {
    financeStore.replaceAll([]);
    taskStore.replaceAll([]);
    localStorage.removeItem('user_profile');
    localStorage.removeItem('theme');
    localStorage.removeItem('notification_settings');
    localStorage.removeItem('security_pin_hashed');
  },

  async getStats() {
    const [finance, tasks] = await Promise.all([
      financeStore.getAll(),
      taskStore.getAll(),
    ]);

    return {
      finance: finance.length,
      tasks: tasks.length,
      totalSize: JSON.stringify({
        finance,
        tasks
      }).length
    };
  },

  getSyncStatus(): {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastError: string | null;
    retryCount: number;
    lastSuccessfulSync: string | null;
  } {
    return {
      status: syncStatus,
      lastError: lastSyncError?.message || null,
      retryCount: syncRetryCount,
      lastSuccessfulSync
    };
  },

  async triggerSync(): Promise<{ success: boolean; error?: string }> {
    const { syncEngine } = await import('../sync');
    try {
      await syncEngine.syncNow('finance');
      await syncEngine.syncNow('tasks');
      syncStatus = 'success';
      lastSuccessfulSync = new Date().toISOString();
      return { success: true };
    } catch (error) {
      syncStatus = 'error';
      lastSyncError = error instanceof Error ? error : new Error('Unknown error');
      return { success: false, error: lastSyncError.message };
    }
  }
};

// ============================================================================
// 初始化（保持兼容）
// ============================================================================

export const initDB = async () => {
  return true;
};

// ============================================================================
// React Hook（保持兼容）
// ============================================================================

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
