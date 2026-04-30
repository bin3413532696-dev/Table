function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  const counter = Math.floor(Math.random() * 1000).toString(36).padStart(3, '0');
  return `${timestamp}-${random}-${counter}`;
}

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const hashedInput = await hashPin(pin);
  return hashedInput === hashedPin;
}

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 10 && /^[a-z0-9-]+$/i.test(id);
}

function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

function isValidFinanceRecord(record: unknown): record is FinanceRecord {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as FinanceRecord;
  return (
    isValidId(r.id) &&
    (r.type === 'income' || r.type === 'expense') &&
    typeof r.amount === 'number' && r.amount >= 0 &&
    typeof r.description === 'string' &&
    typeof r.category === 'string' &&
    isValidDate(r.date) &&
    (r.model === undefined || typeof r.model === 'string')
  );
}

function isValidTask(record: unknown): record is Task {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as Task;
  return (
    isValidId(r.id) &&
    typeof r.title === 'string' &&
    typeof r.completed === 'boolean' &&
    isValidDate(r.createdAt) &&
    (r.priority === 'low' || r.priority === 'medium' || r.priority === 'high') &&
    (r.dueDate === undefined || isValidDate(r.dueDate))
  );
}

interface FinanceRecord {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  date: string;
  model?: string;
}

interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
}

const STORAGE_KEYS = {
  finance: 'finance_records',
  tasks: 'tasks_records'
};

type CollectionType = 'finance' | 'tasks';
type Listener = (collection: CollectionType) => void;

const listeners = new Set<Listener>();

function notifyChange(collection: CollectionType) {
  listeners.forEach(listener => listener(collection));
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadFromStorage<T>(key: string): T[] {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

let storageError: Error | null = null;

function saveToStorage<T>(key: string, records: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(records));
    storageError = null;
  } catch (error) {
    storageError = error instanceof Error ? error : new Error('Storage error');
    console.error('[DB] Failed to save to localStorage:', storageError);
    return;
  }

  scheduleSync();

  const collectionMap: Record<string, CollectionType> = {
    [STORAGE_KEYS.finance]: 'finance',
    [STORAGE_KEYS.tasks]: 'tasks'
  };

  const collection = collectionMap[key];
  if (collection) {
    notifyChange(collection);
  }
}

export function getStorageError(): Error | null {
  return storageError;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncStatus: 'idle' | 'syncing' | 'success' | 'error' = 'idle';
let lastSyncError: Error | null = null;
let syncRetryCount = 0;
const MAX_RETRY_COUNT = 3;

interface SyncResult {
  success: boolean;
  timestamp?: string;
  error?: string;
}

async function performSync(): Promise<SyncResult> {
  try {
    syncStatus = 'syncing';
    syncRetryCount = 0;

    const response = await fetch('/api/sync-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: taskStore.getAll(),
        finance: financeStore.getAll()
      })
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    syncStatus = 'success';
    lastSyncError = null;
    return { success: true, timestamp: new Date().toISOString() };
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown sync error');
    lastSyncError = err;
    syncStatus = 'error';

    if (syncRetryCount < MAX_RETRY_COUNT) {
      syncRetryCount++;
      const delay = Math.pow(2, syncRetryCount) * 1000;
      setTimeout(performSync, delay);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn('[DB Sync] Failed to sync data to disk:', err.message);
    }

    return { success: false, timestamp: new Date().toISOString(), error: err.message };
  }
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (typeof fetch !== 'undefined') {
      performSync();
    }
  }, 1500);
}

class Store<T extends { id: string }> {
  private records: T[];
  private storageKey: string;
  private collectionType: CollectionType;
  private validator: (record: unknown) => record is T;
  private delayedSave: boolean = false;

  constructor(storageKey: string, collectionType: CollectionType, validator: (record: unknown) => record is T) {
    this.storageKey = storageKey;
    this.collectionType = collectionType;
    this.validator = validator;
    this.records = loadFromStorage<T>(storageKey);
  }

  getAll(): T[] {
    return [...this.records];
  }

  getById(id: string): T | undefined {
    return this.records.find(r => r.id === id);
  }

  add(record: Omit<T, 'id'>): T {
    const newRecord = { ...record, id: generateId() } as T;
    this.records = [newRecord, ...this.records];
    if (!this.delayedSave) {
      this.save();
    }
    return newRecord;
  }

  update(id: string, updates: Partial<T>): void {
    this.records = this.records.map(r => r.id === id ? { ...r, ...updates } : r);
    if (!this.delayedSave) {
      this.save();
    }
  }

  delete(id: string): void {
    this.records = this.records.filter(r => r.id !== id);
    if (!this.delayedSave) {
      this.save();
    }
  }

  filter(predicate: (record: T) => boolean): T[] {
    return this.records.filter(predicate);
  }

  map<U>(fn: (record: T) => U): U[] {
    return this.records.map(fn);
  }

  reduce<U>(fn: (acc: U, record: T) => U, initial: U): U {
    return this.records.reduce(fn, initial);
  }

  get length(): number {
    return this.records.length;
  }

  save(): void {
    saveToStorage(this.storageKey, this.records);
  }

  replaceAll(records: T[]): void {
    this.records = records;
    if (!this.delayedSave) {
      this.save();
    }
  }

  setDelayedSave(delayed: boolean): void {
    this.delayedSave = delayed;
  }

  cloneRecords(): T[] {
    return JSON.parse(JSON.stringify(this.records));
  }

  restoreRecords(records: T[]): void {
    this.records = records;
  }

  getRecords(): T[] {
    return this.records;
  }
}

interface TransactionOperation {
  store: Store<any>;
  before: any[];
}

class Transaction {
  private operations: TransactionOperation[] = [];
  private active: boolean = false;

  begin(): void {
    if (this.active) {
      throw new Error('Transaction already active');
    }
    this.active = true;
    this.operations = [];
  }

  registerStore(store: Store<any>): void {
    if (!this.active) {
      throw new Error('No active transaction');
    }
    this.operations.push({
      store,
      before: store.cloneRecords()
    });
    store.setDelayedSave(true);
  }

  commit(): void {
    if (!this.active) {
      throw new Error('No active transaction');
    }
    try {
      for (const op of this.operations) {
        op.store.save();
      }
      this.active = false;
    } finally {
      for (const op of this.operations) {
        op.store.setDelayedSave(false);
      }
    }
  }

  rollback(): void {
    if (!this.active) {
      throw new Error('No active transaction');
    }
    try {
      for (const op of this.operations) {
        op.store.restoreRecords(op.before);
      }
    } finally {
      for (const op of this.operations) {
        op.store.setDelayedSave(false);
      }
      this.active = false;
    }
  }

  get isActive(): boolean {
    return this.active;
  }
}

const transaction = new Transaction();

const financeStore = new Store<FinanceRecord>(STORAGE_KEYS.finance, 'finance', isValidFinanceRecord);
const taskStore = new Store<Task>(STORAGE_KEYS.tasks, 'tasks', isValidTask);

export async function runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
  transaction.begin();
  try {
    transaction.registerStore(taskStore);
    transaction.registerStore(financeStore);

    const result = await fn();
    transaction.commit();
    return result;
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

export const initDB = async () => {
  return true;
};

export const financeDB = {
  async getAll(): Promise<FinanceRecord[]> {
    return financeStore.getAll().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    return financeStore.add(record);
  },

  async update(id: string, updates: Partial<FinanceRecord>): Promise<void> {
    financeStore.update(id, updates);
  },

  async delete(id: string): Promise<void> {
    financeStore.delete(id);
  },

  async getStats() {
    const income = financeStore.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
    const expense = financeStore.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    return { income, expense, profit: income - expense };
  },

  async getModelStats(): Promise<Record<string, { expense: number; income: number }>> {
    const stats: Record<string, { expense: number; income: number }> = {};
    financeStore.map(r => {
      const model = r.model || '其他';
      if (!stats[model]) stats[model] = { expense: 0, income: 0 };
      if (r.type === 'expense') stats[model].expense += r.amount;
      else stats[model].income += r.amount;
    });
    return stats;
  }
};

export const taskDB = {
  async getAll(): Promise<Task[]> {
    return taskStore.getAll().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async add(record: Omit<Task, 'id'>): Promise<Task> {
    return taskStore.add({ ...record, dueDate: record.dueDate || undefined });
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    taskStore.update(id, updates);
  },

  async delete(id: string): Promise<void> {
    taskStore.delete(id);
  },

  async toggle(id: string): Promise<void> {
    const task = taskStore.getById(id);
    if (task) {
      taskStore.update(id, { completed: !task.completed });
    }
  },

  async getStats() {
    const total = taskStore.length;
    const completed = taskStore.filter(r => r.completed).length;
    const pending = total - completed;
    return { total, completed, pending };
  }
};

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
      const validators = {
        finance: isValidFinanceRecord,
        tasks: isValidTask
      };
      const stores = {
        finance: financeStore,
        tasks: taskStore
      };

      for (const key of ['finance', 'tasks'] as const) {
        if (key in data) {
          if (!Array.isArray(data[key])) return false;
          const validRecords = data[key].filter(validators[key]);
          if (validRecords.length !== data[key].length) return false;
          stores[key].replaceAll(validRecords);
        }
      }

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
    } catch {
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

  getStats() {
    return {
      finance: financeStore.length,
      tasks: taskStore.length,
      totalSize: JSON.stringify({
        finance: financeStore.getAll(),
        tasks: taskStore.getAll()
      }).length
    };
  },

  getSyncStatus(): {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastError: string | null;
    retryCount: number;
  } {
    return {
      status: syncStatus,
      lastError: lastSyncError?.message || null,
      retryCount: syncRetryCount
    };
  },

  async triggerSync(): Promise<{ success: boolean; error?: string }> {
    if (typeof fetch === 'undefined') {
      return { success: false, error: 'Fetch not available' };
    }
    const result = await performSync();
    return { success: result.success, error: result.error };
  }
};

export type { FinanceRecord, Task };
export { hashPin };

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
