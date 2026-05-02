/**
 * 数据同步服务
 * 负责浏览器存储与服务器文件之间的双向同步
 *
 * 注意：此文件作为 sync/ 模块的兼容层
 * 核心同步逻辑已迁移到 src/sync/SyncEngine.ts
 */

import { syncEngine, SyncStatus, SyncResult, LoadResult } from '../sync';
import { financeStore, taskStore, noteStore } from '../store/impl';
import { subscribeDataChange } from '../core/events';
import { KnowledgeNote } from '../core/types';

// ==================== 类型导出 ====================

export type { SyncStatus, SyncResult, LoadResult };

// ==================== 同步状态 ====================

export function getSyncStatus() {
  return syncEngine.getStatus();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  return syncEngine.subscribe(listener);
}

// ==================== 初始化加载 ====================

export async function initializeData(): Promise<boolean> {
  console.log('[Sync] Initializing data from server...');

  const result = await syncEngine.loadFromServer();

  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to load from server:', result.error);
    return false;
  }

  const { finance, tasks, notes } = result.data;

  // 合并数据到本地存储
  // 策略：服务器数据优先，但保留本地更新的数据

  // 财务数据
  if (Array.isArray(finance) && finance.length > 0) {
    const localFinance = await financeStore.getAll();
    if (localFinance.length === 0 || finance.length > localFinance.length) {
      financeStore.replaceAll(finance as any);
    }
  }

  // 任务数据
  if (Array.isArray(tasks) && tasks.length > 0) {
    const localTasks = await taskStore.getAll();
    if (localTasks.length === 0 || tasks.length > localTasks.length) {
      taskStore.replaceAll(tasks as any);
    }
  }

  // 笔记数据
  if (Array.isArray(notes) && notes.length > 0) {
    const localNotes = await noteStore.getAll();
    if (localNotes.length === 0 || notes.length > localNotes.length) {
      await noteStore.importNotes(notes as any);
    }
  }

  console.log('[Sync] Data initialized successfully');
  return true;
}

// ==================== 自动同步 ====================

export function startAutoSync() {
  // 监听财务变化
  subscribeDataChange('finance', () => {
    syncEngine.schedule('finance');
  });

  // 监听任务变化
  subscribeDataChange('tasks', () => {
    syncEngine.schedule('tasks');
  });

  // 监听笔记变化
  subscribeDataChange('notes', () => {
    syncEngine.schedule('notes');
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
  const result = await syncEngine.loadFromServer();

  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to reload data after server change');
    return;
  }

  const { finance, tasks, notes } = result.data;

  // 更新本地数据（触发 UI 更新）

  // 比较并更新笔记
  if (Array.isArray(notes)) {
    const localNotes = await noteStore.getAll();
    const localMap = new Map(localNotes.map(n => [n.id, n]));
    const serverMap = new Map(notes.map(n => [n.id, n]));

    // 找出需要更新的笔记
    for (const [id, serverNote] of serverMap) {
      const localNote = localMap.get(id);
      if (!localNote || localNote.updatedAt < (serverNote as any).updatedAt) {
        await noteStore.update(id, serverNote as any);
      }
    }

    // 找出需要删除的笔记
    for (const [id] of localMap) {
      if (!serverMap.has(id)) {
        await noteStore.delete(id);
      }
    }
  }

  // 更新财务数据
  if (Array.isArray(finance)) {
    const localFinance = await financeStore.getAll();
    const localMap = new Map(localFinance.map(r => [r.id, r]));
    const serverMap = new Map(finance.map(r => [r.id, r]));

    for (const [id, serverRecord] of serverMap) {
      const localRecord = localMap.get(id);
      if (!localRecord || localRecord.updatedAt < serverRecord.updatedAt) {
        await financeStore.update(id, serverRecord);
      }
    }

    for (const [id] of localMap) {
      if (!serverMap.has(id)) {
        await financeStore.delete(id);
      }
    }
  }

  // 更新任务数据
  if (Array.isArray(tasks)) {
    const localTasks = await taskStore.getAll();
    const localMap = new Map(localTasks.map(t => [t.id, t]));
    const serverMap = new Map(tasks.map(t => [t.id, t]));

    for (const [id, serverTask] of serverMap) {
      const localTask = localMap.get(id);
      if (!localTask || localTask.updatedAt < serverTask.updatedAt) {
        await taskStore.update(id, serverTask);
      }
    }

    for (const [id] of localMap) {
      if (!serverMap.has(id)) {
        await taskStore.delete(id);
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
  return syncEngine.syncNow('all');
}

export async function syncFinance(): Promise<SyncResult> {
  return syncEngine.syncNow('finance');
}

export async function syncTasks(): Promise<SyncResult> {
  return syncEngine.syncNow('tasks');
}

export async function syncNotes(): Promise<SyncResult> {
  return syncEngine.syncNow('notes');
}

export async function loadAllFromServer(): Promise<LoadResult> {
  return syncEngine.loadFromServer();
}