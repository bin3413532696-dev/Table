import { syncEngine, SyncStatus, SyncResult, LoadResult } from '../sync';
import { SYNC_CONFIG } from '../sync/config';

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
    const { financeDB, taskDB } = await import('../db');
    await Promise.all([
      financeDB.getAll(),
      taskDB.getAll(),
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
  return { success: true, timestamp: Date.now() };
}

export async function forceSyncNow(): Promise<SyncResult> {
  return { success: true, timestamp: Date.now() };
}

export function startAutoSync(): () => void {
  console.log('[Sync] Auto sync started');
  return () => console.log('[Sync] Auto sync stopped');
}

export function startRealtimeSync(): () => void {
  console.log('[Sync] Realtime sync started');
  return () => console.log('[Sync] Realtime sync stopped');
}