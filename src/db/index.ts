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

function loadFromStorage<T>(key: string): T[] {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveToStorage<T>(key: string, records: T[]) {
  localStorage.setItem(key, JSON.stringify(records));
  scheduleSync();
}

// ── 自动同步到 data/ 文件夹 ──
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    try {
      fetch('/api/sync-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: noteRecords,
          folders: folderRecords,
          tasks: taskRecords,
          finance: financeRecords
        })
      }).catch(() => {
        /* 开发服务器未运行时静默忽略 */
      });
    } catch {
      /* 兼容非浏览器环境 */
    }
  }, 1500); // 防抖 1.5 秒
}

let financeRecords: FinanceRecord[] = loadFromStorage(STORAGE_KEYS.finance);
let taskRecords: Task[] = loadFromStorage(STORAGE_KEYS.tasks);
let noteRecords: Note[] = loadFromStorage(STORAGE_KEYS.notes);
let folderRecords: Folder[] = loadFromStorage(STORAGE_KEYS.folders);

export const initDB = async () => {
  financeRecords = loadFromStorage(STORAGE_KEYS.finance);
  taskRecords = loadFromStorage(STORAGE_KEYS.tasks);
  noteRecords = loadFromStorage(STORAGE_KEYS.notes);
  folderRecords = loadFromStorage(STORAGE_KEYS.folders);
  return true;
};

export const financeDB = {
  async getAll(): Promise<FinanceRecord[]> {
    return [...financeRecords].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    const newRecord: FinanceRecord = { ...record, id: Date.now().toString() };
    financeRecords = [newRecord, ...financeRecords];
    saveToStorage(STORAGE_KEYS.finance, financeRecords);
    return newRecord;
  },

  async update(id: string, updates: Partial<FinanceRecord>): Promise<void> {
    financeRecords = financeRecords.map(r => r.id === id ? { ...r, ...updates } : r);
    saveToStorage(STORAGE_KEYS.finance, financeRecords);
  },

  async delete(id: string): Promise<void> {
    financeRecords = financeRecords.filter(r => r.id !== id);
    saveToStorage(STORAGE_KEYS.finance, financeRecords);
  },

  async getStats() {
    const income = financeRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
    const expense = financeRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    return { income, expense, profit: income - expense };
  },

  async getModelStats(): Promise<Record<string, { expense: number; income: number }>> {
    const stats: Record<string, { expense: number; income: number }> = {};
    financeRecords.forEach(r => {
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
    return [...taskRecords].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async add(record: Omit<Task, 'id'>): Promise<Task> {
    const newRecord: Task = { ...record, id: Date.now().toString(), dueDate: record.dueDate || undefined };
    taskRecords = [newRecord, ...taskRecords];
    saveToStorage(STORAGE_KEYS.tasks, taskRecords);
    return newRecord;
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    taskRecords = taskRecords.map(r => r.id === id ? { ...r, ...updates } : r);
    saveToStorage(STORAGE_KEYS.tasks, taskRecords);
  },

  async delete(id: string): Promise<void> {
    taskRecords = taskRecords.filter(r => r.id !== id);
    saveToStorage(STORAGE_KEYS.tasks, taskRecords);
  },

  async toggle(id: string): Promise<void> {
    const task = taskRecords.find(r => r.id === id);
    if (task) {
      task.completed = !task.completed;
      saveToStorage(STORAGE_KEYS.tasks, taskRecords);
    }
  },

  async getStats() {
    const total = taskRecords.length;
    const completed = taskRecords.filter(r => r.completed).length;
    const pending = total - completed;
    return { total, completed, pending };
  }
};

export const noteDB = {
  async getAll(): Promise<Note[]> {
    return [...noteRecords].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async getByFolder(folderId: string | null): Promise<Note[]> {
    return noteRecords.filter(n => n.folderId === folderId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async add(record: Omit<Note, 'id'>): Promise<Note> {
    const newRecord: Note = {
      ...record,
      id: Date.now().toString(),
      tags: record.tags || [],
      links: record.links || [],
      backlinks: record.backlinks || [],
      folderId: record.folderId || null,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
    noteRecords = [newRecord, ...noteRecords];
    saveToStorage(STORAGE_KEYS.notes, noteRecords);
    return newRecord;
  },

  async update(id: string, updates: Partial<Note>): Promise<void> {
    noteRecords = noteRecords.map(r => r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r);
    saveToStorage(STORAGE_KEYS.notes, noteRecords);
  },

  async delete(id: string): Promise<void> {
    noteRecords = noteRecords.filter(r => r.id !== id);
    saveToStorage(STORAGE_KEYS.notes, noteRecords);
  },

  async search(query: string): Promise<Note[]> {
    const lowerQuery = query.toLowerCase();
    return noteRecords.filter(n =>
      n.title.toLowerCase().includes(lowerQuery) ||
      n.content.toLowerCase().includes(lowerQuery)
    );
  },

  async updateLinks(noteId: string, links: string[]): Promise<void> {
    const note = noteRecords.find(n => n.id === noteId);
    if (note) {
      const oldLinks = note.links || [];
      const removedLinks = oldLinks.filter(l => !links.includes(l));
      const addedLinks = links.filter(l => !oldLinks.includes(l));

      note.links = links;

      removedLinks.forEach(linkedTitle => {
        const linkedNote = noteRecords.find(n => n.title === linkedTitle);
        if (linkedNote) {
          linkedNote.backlinks = (linkedNote.backlinks || []).filter(b => b !== note.title);
        }
      });

      addedLinks.forEach(linkedTitle => {
        const linkedNote = noteRecords.find(n => n.title === linkedTitle);
        if (linkedNote) {
          linkedNote.backlinks = [...(linkedNote.backlinks || []), note.title];
        }
      });

      saveToStorage(STORAGE_KEYS.notes, noteRecords);
    }
  },

  async getBacklinks(noteTitle: string): Promise<Note[]> {
    return noteRecords.filter(n => (n.links || []).includes(noteTitle));
  }
};

export const folderDB = {
  async getAll(): Promise<Folder[]> {
    return [...folderRecords].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async getByParent(parentId: string | null): Promise<Folder[]> {
    return folderRecords.filter(f => f.parentId === parentId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  async add(record: Omit<Folder, 'id'>): Promise<Folder> {
    const newRecord: Folder = {
      ...record,
      id: Date.now().toString(),
      parentId: record.parentId || null,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
    folderRecords = [newRecord, ...folderRecords];
    saveToStorage(STORAGE_KEYS.folders, folderRecords);
    return newRecord;
  },

  async update(id: string, updates: Partial<Folder>): Promise<void> {
    folderRecords = folderRecords.map(f => f.id === id ? { ...f, ...updates, updatedAt: new Date().toISOString() } : f);
    saveToStorage(STORAGE_KEYS.folders, folderRecords);
  },

  async delete(id: string): Promise<void> {
    // 递归收集所有子文件夹 ID
    const collectDescendants = (parentId: string): string[] => {
      const children = folderRecords.filter(f => f.parentId === parentId);
      return [
        ...children.map(c => c.id),
        ...children.flatMap(c => collectDescendants(c.id))
      ];
    };
    const descendantIds = collectDescendants(id);
    const allToDelete = [id, ...descendantIds];

    // 删除所有子文件夹及其笔记关联
    descendantIds.forEach(did => {
      noteRecords = noteRecords.map(n => n.folderId === did ? { ...n, folderId: null } : n);
    });
    noteRecords = noteRecords.map(n => n.folderId === id ? { ...n, folderId: null } : n);
    folderRecords = folderRecords.filter(f => !allToDelete.includes(f.id));
    saveToStorage(STORAGE_KEYS.folders, folderRecords);
    saveToStorage(STORAGE_KEYS.notes, noteRecords);
  },

  async getTree(): Promise<Array<Folder & { children: Folder[] }>> {
    const rootFolders = folderRecords.filter(f => f.parentId === null);
    return rootFolders.map(folder => ({
      ...folder,
      children: folderRecords.filter(f => f.parentId === folder.id)
    }));
  }
};

export const dataManager = {
  exportAll(): string {
    const data = {
      version: 1,
      finance: financeRecords,
      tasks: taskRecords,
      notes: noteRecords,
      folders: folderRecords,
      exportTime: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  },

  importAll(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      // 只有导入数据中明确包含某集合时才替换，避免误覆盖
      if ('finance' in data) {
        if (!Array.isArray(data.finance)) return false;
        financeRecords = data.finance;
        saveToStorage(STORAGE_KEYS.finance, financeRecords);
      }
      if ('tasks' in data) {
        if (!Array.isArray(data.tasks)) return false;
        taskRecords = data.tasks;
        saveToStorage(STORAGE_KEYS.tasks, taskRecords);
      }
      if ('notes' in data) {
        if (!Array.isArray(data.notes)) return false;
        noteRecords = data.notes;
        saveToStorage(STORAGE_KEYS.notes, noteRecords);
      }
      if ('folders' in data) {
        if (!Array.isArray(data.folders)) return false;
        folderRecords = data.folders;
        saveToStorage(STORAGE_KEYS.folders, folderRecords);
      }
      return true;
    } catch {
      return false;
    }
  },

  clearAll(): void {
    financeRecords = [];
    taskRecords = [];
    noteRecords = [];
    folderRecords = [];
    saveToStorage(STORAGE_KEYS.finance, []);
    saveToStorage(STORAGE_KEYS.tasks, []);
    saveToStorage(STORAGE_KEYS.notes, []);
    saveToStorage(STORAGE_KEYS.folders, []);
  },

  getStats() {
    const financeData = { finance: financeRecords, tasks: taskRecords, notes: noteRecords, folders: folderRecords };
    return {
      finance: financeRecords.length,
      tasks: taskRecords.length,
      notes: noteRecords.length,
      folders: folderRecords.length,
      totalSize: JSON.stringify(financeData).length
    };
  }
};

export type { FinanceRecord, Task, Note, Folder };
