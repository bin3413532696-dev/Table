import Fuse from 'fuse.js';

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  const counter = Math.floor(Math.random() * 1000).toString(36).padStart(3, '0');
  return `${timestamp}-${random}-${counter}`;
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

function isValidFolder(record: unknown): record is Folder {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as Folder;
  return (
    isValidId(r.id) &&
    typeof r.name === 'string' &&
    (r.parentId === null || isValidId(r.parentId)) &&
    isValidDate(r.createdAt) &&
    isValidDate(r.updatedAt) &&
    typeof r.noteCount === 'number' && r.noteCount >= 0
  );
}

function isValidNote(record: unknown): record is Note {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as Note;
  return (
    isValidId(r.id) &&
    typeof r.title === 'string' &&
    typeof r.content === 'string' &&
    (r.folderId === null || isValidId(r.folderId)) &&
    isValidDate(r.createdAt) &&
    isValidDate(r.updatedAt) &&
    Array.isArray(r.tags) && r.tags.every(t => typeof t === 'string') &&
    Array.isArray(r.links) && r.links.every(l => typeof l === 'string') &&
    Array.isArray(r.backlinks) && r.backlinks.every(b => typeof b === 'string')
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

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

interface Note {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  links: string[];
  backlinks: string[];
}

const STORAGE_KEYS = {
  finance: 'finance_records',
  tasks: 'tasks_records',
  notes: 'notes_records',
  folders: 'folders_records'
};

type CollectionType = 'finance' | 'tasks' | 'notes' | 'folders';
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
    [STORAGE_KEYS.tasks]: 'tasks',
    [STORAGE_KEYS.notes]: 'notes',
    [STORAGE_KEYS.folders]: 'folders'
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
        notes: noteStore.getAll(),
        folders: folderStore.getAll(),
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

export async function runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
  transaction.begin();
  try {
    transaction.registerStore(noteStore);
    transaction.registerStore(folderStore);
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

const financeStore = new Store<FinanceRecord>(STORAGE_KEYS.finance, 'finance', isValidFinanceRecord);
const taskStore = new Store<Task>(STORAGE_KEYS.tasks, 'tasks', isValidTask);
const noteStore = new Store<Note>(STORAGE_KEYS.notes, 'notes', isValidNote);
const folderStore = new Store<Folder>(STORAGE_KEYS.folders, 'folders', isValidFolder);

export const initDB = async () => {
  await migrateLinksFromTitleToId(noteStore.getAll());
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

async function migrateLinksFromTitleToId(notes: Note[]): Promise<void> {
  let needsMigration = false;

  for (const note of notes) {
    if ((note.links || []).length > 0) {
      const hasTitleLink = note.links.some(l => l.includes(' ') || l.length < 5);
      if (hasTitleLink) {
        needsMigration = true;
        break;
      }
    }
    if ((note.backlinks || []).length > 0) {
      const hasTitleBacklink = note.backlinks.some(l => l.includes(' ') || l.length < 5);
      if (hasTitleBacklink) {
        needsMigration = true;
        break;
      }
    }
  }
  
  if (!needsMigration) return;

  const titleToId = new Map<string, string>();
  const idToNote = new Map<string, Note>();

  for (const note of notes) {
    titleToId.set(note.title, note.id);
    idToNote.set(note.id, note);
  }

  const migratedRecords = notes.map(note => {
    const newLinks: string[] = [];
    for (const link of (note.links || [])) {
      if (idToNote.has(link)) {
        newLinks.push(link);
      } else if (titleToId.has(link)) {
        newLinks.push(titleToId.get(link)!);
      }
    }
    
    const newBacklinks: string[] = [];
    for (const backlink of (note.backlinks || [])) {
      if (idToNote.has(backlink)) {
        newBacklinks.push(backlink);
      } else if (titleToId.has(backlink)) {
        newBacklinks.push(titleToId.get(backlink)!);
      }
    }
    
    return { ...note, links: newLinks, backlinks: newBacklinks };
  });
  
  noteStore.replaceAll(migratedRecords);
}

let fuseCache: { notes: Note[]; fuse: Fuse<Note> } | null = null;

function getFuseInstance(notes: Note[]): Fuse<Note> {
  if (fuseCache && fuseCache.notes === notes) {
    return fuseCache.fuse;
  }
  const fuse = new Fuse(notes, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'content', weight: 1 }
    ],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 1
  });
  fuseCache = { notes, fuse };
  return fuse;
}

export const noteDB = {
  async getAll(): Promise<Note[]> {
    return noteStore.getAll().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async getByFolder(folderId: string | null): Promise<Note[]> {
    return noteStore.filter(n => n.folderId === folderId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async add(record: Omit<Note, 'id'>): Promise<Note> {
    return runInTransaction(() => {
      const now = new Date().toISOString();
      const folderId = record.folderId || null;

      const newNote = noteStore.add({
        ...record,
        tags: record.tags || [],
        links: record.links || [],
        backlinks: record.backlinks || [],
        folderId,
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now
      });

      if (folderId) {
        const folder = folderStore.getById(folderId);
        if (folder) {
          folderStore.update(folderId, { noteCount: folder.noteCount + 1 });
        }
      }

      fuseCache = null;
      return newNote;
    });
  },

  async update(id: string, updates: Partial<Note>): Promise<void> {
    if ('folderId' in updates) {
      return runInTransaction(() => {
        const note = noteStore.getById(id);
        if (!note) return;

        const oldFolderId = note.folderId;
        const newFolderId = updates.folderId || null;

        if (oldFolderId !== newFolderId) {
          if (oldFolderId) {
            const oldFolder = folderStore.getById(oldFolderId);
            if (oldFolder) {
              folderStore.update(oldFolderId, { noteCount: Math.max(0, oldFolder.noteCount - 1) });
            }
          }

          if (newFolderId) {
            const newFolder = folderStore.getById(newFolderId);
            if (newFolder) {
              folderStore.update(newFolderId, { noteCount: newFolder.noteCount + 1 });
            }
          }
        }

        noteStore.update(id, { ...updates, updatedAt: new Date().toISOString() });
        fuseCache = null;
      });
    } else {
      noteStore.update(id, { ...updates, updatedAt: new Date().toISOString() });
      fuseCache = null;
    }
  },

  async delete(id: string): Promise<void> {
    return runInTransaction(() => {
      const note = noteStore.getById(id);
      if (!note) return;

      const folderId = note.folderId;
      if (folderId) {
        const folder = folderStore.getById(folderId);
        if (folder) {
          folderStore.update(folderId, { noteCount: Math.max(0, folder.noteCount - 1) });
        }
      }

      for (const other of noteStore.filter(n => (n.backlinks || []).includes(id))) {
        noteStore.update(other.id, {
          backlinks: (other.backlinks || []).filter(b => b !== id)
        });
      }

      noteStore.delete(id);
      fuseCache = null;
    });
  },

  async search(query: string): Promise<Note[]> {
    if (!query.trim()) return this.getAll();

    const allNotes = noteStore.getAll();
    const fuse = getFuseInstance(allNotes);
    return fuse.search(query).map(r => r.item);
  },

  async updateLinks(noteId: string, links: string[]): Promise<void> {
    const note = noteStore.getById(noteId);
    if (!note) return;

    const oldLinks = note.links || [];
    const removedLinks = oldLinks.filter(l => !links.includes(l));
    const addedLinks = links.filter(l => !oldLinks.includes(l));

    return runInTransaction(() => {
      noteStore.update(noteId, { links });

      for (const removedId of removedLinks) {
        const target = noteStore.getById(removedId);
        if (target) {
          noteStore.update(removedId, {
            backlinks: (target.backlinks || []).filter(b => b !== noteId)
          });
        }
      }

      for (const addedId of addedLinks) {
        const target = noteStore.getById(addedId);
        if (target) {
          noteStore.update(addedId, {
            backlinks: [...(target.backlinks || []), noteId]
          });
        }
      }
      fuseCache = null;
    });
  },

  async getBacklinks(noteId: string): Promise<Note[]> {
    return noteStore.filter(n => (n.links || []).includes(noteId));
  }
};

type FolderTreeNode = Folder & { children: FolderTreeNode[] };

export const folderDB = {
  async getAll(): Promise<Folder[]> {
    return folderStore.getAll().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async getByParent(parentId: string | null): Promise<Folder[]> {
    return folderStore.filter(f => f.parentId === parentId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async add(record: Omit<Folder, 'id'>): Promise<Folder> {
    const now = new Date().toISOString();
    return folderStore.add({
      ...record,
      parentId: record.parentId || null,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
      noteCount: record.noteCount || 0
    });
  },

  async update(id: string, updates: Partial<Folder>): Promise<void> {
    folderStore.update(id, { ...updates, updatedAt: new Date().toISOString() });
  },

  async delete(id: string): Promise<void> {
    return runInTransaction(() => {
      const allFolders = folderStore.getAll();
      const childMap = new Map<string, string[]>();
      for (const folder of allFolders) {
        const key = folder.parentId || '';
        if (!childMap.has(key)) {
          childMap.set(key, []);
        }
        childMap.get(key)!.push(folder.id);
      }

      const descendantIds: string[] = [];
      const stack = [id];

      while (stack.length > 0) {
        const currentId = stack.pop()!;
        const children = childMap.get(currentId) || [];
        for (const childId of children) {
          descendantIds.push(childId);
          stack.push(childId);
        }
      }

      const allToDelete = new Set([id, ...descendantIds]);

      const allNotes = noteStore.getAll();
      const updatedNotes = allNotes.map(n => {
        if (allToDelete.has(n.folderId || '')) {
          return { ...n, folderId: null };
        }
        return n;
      });
      const updatedFolders = allFolders.filter(f => !allToDelete.has(f.id));

      folderStore.replaceAll(updatedFolders);
      noteStore.replaceAll(updatedNotes);
    });
  },

  async getTree(): Promise<FolderTreeNode[]> {
    const allFolders = folderStore.getAll();
    const folderMap = new Map<string, FolderTreeNode>();
    const roots: FolderTreeNode[] = [];

    for (const f of allFolders) {
      folderMap.set(f.id, { ...f, children: [] });
    }

    for (const node of folderMap.values()) {
      if (node.parentId && folderMap.has(node.parentId)) {
        folderMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
};

export const dataManager = {
  exportAll(): string {
    const data = {
      version: 1,
      finance: financeStore.getAll(),
      tasks: taskStore.getAll(),
      notes: noteStore.getAll(),
      folders: folderStore.getAll(),
      exportTime: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  },

  importAll(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      const validators = {
        finance: isValidFinanceRecord,
        tasks: isValidTask,
        notes: isValidNote,
        folders: isValidFolder
      };
      const stores = {
        finance: financeStore,
        tasks: taskStore,
        notes: noteStore,
        folders: folderStore
      };

      for (const key of ['finance', 'tasks', 'notes', 'folders'] as const) {
        if (key in data) {
          if (!Array.isArray(data[key])) return false;
          
          let processedRecords = data[key];
          
          if (key === 'folders') {
            processedRecords = data[key].map((folder: any) => ({
              ...folder,
              noteCount: folder.noteCount || 0
            }));
          }
          
          const validRecords = processedRecords.filter(validators[key]);
          if (validRecords.length !== processedRecords.length) return false;
          stores[key].replaceAll(validRecords);
        }
      }
      migrateLinksFromTitleToId(noteStore.getAll());
      return true;
    } catch {
      return false;
    }
  },

  clearAll(): void {
    financeStore.replaceAll([]);
    taskStore.replaceAll([]);
    noteStore.replaceAll([]);
    folderStore.replaceAll([]);
  },

  getStats() {
    return {
      finance: financeStore.length,
      tasks: taskStore.length,
      notes: noteStore.length,
      folders: folderStore.length,
      totalSize: JSON.stringify({
        finance: financeStore.getAll(),
        tasks: taskStore.getAll(),
        notes: noteStore.getAll(),
        folders: folderStore.getAll()
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

export type { FinanceRecord, Task, Note, Folder, FolderTreeNode };

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