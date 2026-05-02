/**
 * 数据同步服务
 * 负责浏览器存储与服务器文件之间的双向同步
 */

import { financeDB, taskDB } from '../db';
import { knowledgeDb, noteOperations, subscribeKnowledge, KnowledgeNote } from '../db/knowledge';
import { subscribe } from '../db';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';
type DataType = 'finance' | 'tasks' | 'notes' | 'all';

interface SyncResult {
  success: boolean;
  error?: string;
  timestamp?: number;
}

interface LoadResult {
  success: boolean;
  data?: {
    finance: any[];
    tasks: any[];
    notes: KnowledgeNote[];
    folders: any[];
    config: Record<string, any>;
  };
  error?: string;
}

// ==================== 同步状态 ====================

let syncStatus: SyncStatus = 'idle';
let lastSyncTime: number | null = null;
let lastError: string | null = null;

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(listener => listener());
}

export function getSyncStatus() {
  return { status: syncStatus, lastSyncTime, lastError };
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ==================== 推送数据到服务器 ====================

async function syncToServer(type: DataType = 'all'): Promise<SyncResult> {
  if (syncStatus === 'syncing') {
    return { success: false, error: 'Sync already in progress' };
  }

  syncStatus = 'syncing';
  notifyListeners();

  try {
    const payload: Record<string, any> = {};

    if (type === 'all' || type === 'finance') {
      payload.finance = await financeDB.getAll();
    }
    if (type === 'all' || type === 'tasks') {
      payload.tasks = await taskDB.getAll();
    }
    if (type === 'all' || type === 'notes') {
      payload.notes = await knowledgeDb.notes.toArray();
    }

    const response = await fetch('/api/sync-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    syncStatus = 'success';
    lastSyncTime = result.timestamp || Date.now();
    lastError = null;

    return { success: true, timestamp: lastSyncTime };
  } catch (error) {
    syncStatus = 'error';
    lastError = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: lastError };
  } finally {
    notifyListeners();
  }
}

// ==================== 从服务器拉取数据 ====================

async function loadFromServer(): Promise<LoadResult> {
  try {
    const response = await fetch('/api/load-data');

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Load failed');
    }

    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== 初始化加载 ====================

export async function initializeData(): Promise<boolean> {
  console.log('[Sync] Initializing data from server...');

  const result = await loadFromServer();

  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to load from server:', result.error);
    return false;
  }

  const { finance, tasks, notes } = result.data;

  // 合并数据到本地存储
  // 策略：服务器数据优先，但保留本地更新的数据

  // 财务数据
  if (Array.isArray(finance) && finance.length > 0) {
    const localFinance = await financeDB.getAll();
    if (localFinance.length === 0 || finance.length > localFinance.length) {
      // 清空并重新导入
      for (const record of finance) {
        try {
          await financeDB.add(record);
        } catch {
          // 忽略重复
        }
      }
    }
  }

  // 任务数据
  if (Array.isArray(tasks) && tasks.length > 0) {
    const localTasks = await taskDB.getAll();
    if (localTasks.length === 0 || tasks.length > localTasks.length) {
      for (const task of tasks) {
        try {
          await taskDB.add(task);
        } catch {
          // 忽略重复
        }
      }
    }
  }

  // 笔记数据
  if (Array.isArray(notes) && notes.length > 0) {
    const localNotes = await knowledgeDb.notes.toArray();
    if (localNotes.length === 0 || notes.length > localNotes.length) {
      await noteOperations.importNotes(notes);
    }
  }

  console.log('[Sync] Data initialized successfully');
  return true;
}

// ==================== 自动同步 ====================

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DELAY = 2000;

function scheduleSync(type: DataType = 'all') {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncToServer(type);
  }, SYNC_DELAY);
}

// 监听本地数据变化，自动同步
export function startAutoSync() {
  // 监听财务和任务变化
  subscribe((collection) => {
    scheduleSync(collection === 'finance' ? 'finance' : 'tasks');
  });

  // 监听笔记变化
  subscribeKnowledge(() => {
    scheduleSync('notes');
  });

  console.log('[Sync] Auto sync started');
}

// ==================== WebSocket 实时同步 ====================

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startRealtimeSync() {
  // 仅在开发模式下启用
  if (typeof window === 'undefined') return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[Sync] WebSocket connected');
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'data-changed') {
          console.log('[Sync] Server data changed:', message);
          await handleServerChange(message);
        }
      } catch (e) {
        console.warn('[Sync] Failed to parse WebSocket message:', e);
      }
    };

    socket.onclose = () => {
      console.log('[Sync] WebSocket disconnected, reconnecting...');
      socket = null;
      // 重连
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(startRealtimeSync, 3000);
    };

    socket.onerror = (error) => {
      console.warn('[Sync] WebSocket error:', error);
    };
  } catch (e) {
    console.warn('[Sync] WebSocket not available:', e);
  }
}

async function handleServerChange(message: { type: string; file: string; timestamp: number }) {
  // 从服务器重新加载数据
  const result = await loadFromServer();

  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to reload data after server change');
    return;
  }

  const { finance, tasks, notes } = result.data;

  // 更新本地数据（触发 UI 更新）
  // 这里通过更新 IndexedDB/localStorage 来触发订阅回调

  // 比较并更新笔记
  if (Array.isArray(notes)) {
    const localNotes = await knowledgeDb.notes.toArray();
    const localMap = new Map(localNotes.map(n => [n.id, n]));
    const serverMap = new Map(notes.map(n => [n.id, n]));

    // 找出需要更新的笔记
    for (const [id, serverNote] of serverMap) {
      const localNote = localMap.get(id);
      if (!localNote || localNote.updatedAt < serverNote.updatedAt) {
        await knowledgeDb.notes.put(serverNote);
      }
    }

    // 找出需要删除的笔记
    for (const [id] of localMap) {
      if (!serverMap.has(id)) {
        await knowledgeDb.notes.delete(id);
      }
    }
  }
}

export function stopRealtimeSync() {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ==================== 手动同步 ====================

export async function syncAll(): Promise<SyncResult> {
  return syncToServer('all');
}

export async function syncFinance(): Promise<SyncResult> {
  return syncToServer('finance');
}

export async function syncTasks(): Promise<SyncResult> {
  return syncToServer('tasks');
}

export async function syncNotes(): Promise<SyncResult> {
  return syncToServer('notes');
}

export async function loadAllFromServer(): Promise<LoadResult> {
  return loadFromServer();
}