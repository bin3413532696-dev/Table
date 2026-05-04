import { syncEngine, SyncStatus, SyncResult, LoadResult } from '../sync';
import { financeStore, taskStore } from '../store/impl';
import type { FinanceRecord, Task } from '../core/types';
import { hydrateKnowledgeDataset, restoreKnowledgeDatasetFromCache } from '../kb';

export type { SyncStatus, SyncResult, LoadResult };

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getUpdatedAt(value: unknown): number {
  if (!isRecordObject(value) || typeof value.updatedAt !== 'number') {
    return 0;
  }
  return value.updatedAt;
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: number }>(
  serverItems: T[],
  localItems: T[]
): T[] {
  const merged = new Map<string, T>();

  for (const item of serverItems) {
    merged.set(item.id, item);
  }

  for (const localItem of localItems) {
    const serverItem = merged.get(localItem.id);
    if (!serverItem || localItem.updatedAt > serverItem.updatedAt) {
      merged.set(localItem.id, localItem);
    }
  }

  return Array.from(merged.values());
}

export function getSyncStatus() {
  return syncEngine.getStatus();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  return syncEngine.subscribe(listener);
}

export async function initializeData(): Promise<boolean> {
  console.log('[Sync] Initializing data from authority source...');

  restoreKnowledgeDatasetFromCache();

  const result = await syncEngine.loadFromServer();
  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to load authority data, keeping local cache:', result.error);
    return false;
  }

  const serverFinance = Array.isArray(result.data.finance) ? result.data.finance as FinanceRecord[] : [];
  const serverTasks = Array.isArray(result.data.tasks) ? result.data.tasks as Task[] : [];
  const [localFinance, localTasks] = await Promise.all([
    financeStore.getAll(),
    taskStore.getAll(),
  ]);

  const nextFinance = mergeByUpdatedAt(serverFinance, localFinance);
  const nextTasks = mergeByUpdatedAt(serverTasks, localTasks);

  financeStore.replaceAll(nextFinance);
  taskStore.replaceAll(nextTasks);

  if (result.data.knowledge !== undefined) {
    await hydrateKnowledgeDataset(result.data.knowledge);
  }

  console.log('[Sync] Authority data initialized successfully');
  return true;
}

export function startAutoSync() {
  console.log('[Sync] Auto sync is disabled in authority-source mode');
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startRealtimeSync() {
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
          console.log('[Sync] Authority data changed:', message);
          await handleServerChange();
        }
      } catch (error) {
        console.warn('[Sync] Failed to parse WebSocket message:', error);
      }
    };

    socket.onclose = () => {
      console.log('[Sync] WebSocket disconnected, reconnecting...');
      socket = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(startRealtimeSync, 3000);
    };

    socket.onerror = (error) => {
      console.warn('[Sync] WebSocket error:', error);
    };
  } catch (error) {
    console.warn('[Sync] WebSocket not available:', error);
  }
}

async function handleServerChange() {
  const result = await syncEngine.loadFromServer();
  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to reload authority data after server change');
    return;
  }

  const serverFinance = Array.isArray(result.data.finance) ? result.data.finance as FinanceRecord[] : [];
  const serverTasks = Array.isArray(result.data.tasks) ? result.data.tasks as Task[] : [];

  financeStore.replaceAll(serverFinance);
  taskStore.replaceAll(serverTasks);

  if (result.data.knowledge !== undefined) {
    await hydrateKnowledgeDataset(result.data.knowledge);
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

export async function syncAll(): Promise<SyncResult> {
  return syncEngine.syncNow('all');
}

export async function syncFinance(): Promise<SyncResult> {
  return syncEngine.syncNow('finance');
}

export async function syncTasks(): Promise<SyncResult> {
  return syncEngine.syncNow('tasks');
}

export async function loadAllFromServer(): Promise<LoadResult> {
  return syncEngine.loadFromServer();
}
