import { syncEngine, SyncStatus, SyncResult, LoadResult } from '../sync';
import { SYNC_CONFIG } from '../sync/config';
import { financeApi } from './api/finance';
import { taskApi } from './api/tasks';

export type { SyncStatus, SyncResult, LoadResult };

export function getSyncStatus() {
  return syncEngine.getStatus();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  return syncEngine.subscribe(listener);
}

export async function initializeData(): Promise<boolean> {
  console.log('[Sync] Initializing authority data...');

  try {
    await Promise.all([
      financeApi.getAll(),
      taskApi.getAll(),
    ]);
  } catch (error) {
    console.warn('[Sync] Failed to warm task/finance API cache:', error);
  }

  const result = await syncEngine.loadKnowledgeFromServer();
  if (!result.success) {
    console.warn('[Sync] Failed to load knowledge authority data:', result.error);
    return false;
  }

  console.log('[Sync] Knowledge authority data loaded successfully');
  return true;
}

export async function syncNow(): Promise<SyncResult> {
  return syncEngine.syncNow();
}

export async function forceSyncNow(): Promise<SyncResult> {
  return syncEngine.syncNow();
}

export function startAutoSync(): () => void {
  return () => {};
}

export function startRealtimeSync(): () => void {
  return () => {};
}
