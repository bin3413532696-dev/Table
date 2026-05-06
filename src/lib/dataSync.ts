import { syncEngine, SyncStatus, SyncResult, LoadResult } from '../sync';
import { hydrateKnowledgeDataset } from '../kb';
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
  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to load knowledge authority data:', result.error);
    return false;
  }

  if (result.data.knowledge !== undefined) {
    await hydrateKnowledgeDataset(result.data.knowledge);
  }

  const metadata = await syncEngine.loadKnowledgeMetadata();
  if (metadata.success && metadata.data) {
    lastMetadataKey = `${metadata.data.version}:${metadata.data.updatedAt}`;
  }

  console.log('[Sync] Authority data initialized successfully');
  return true;
}

export function startAutoSync() {
  console.log('[Sync] Auto sync is disabled. Business data now uses direct API reads, knowledge uses explicit sync.');
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastMetadataKey: string | null = null;

export function startRealtimeSync() {
  if (typeof window === 'undefined') return;

  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const poll = async () => {
    try {
      const metadata = await syncEngine.loadKnowledgeMetadata();
      if (!metadata.success || !metadata.data) {
        return;
      }

      const nextKey = `${metadata.data.version}:${metadata.data.updatedAt}`;
      if (lastMetadataKey === nextKey) {
        return;
      }

      lastMetadataKey = nextKey;
      await handleServerChange();
    } catch (error) {
      console.warn('[Sync] Knowledge metadata polling failed:', error);
    }
  };

  void poll();
  pollTimer = setInterval(() => {
    void poll();
  }, SYNC_CONFIG.KNOWLEDGE_POLL_INTERVAL);
}

async function handleServerChange() {
  const result = await syncEngine.loadKnowledgeFromServer();
  if (!result.success || !result.data) {
    console.warn('[Sync] Failed to reload knowledge authority data after server change');
    return;
  }

  if (result.data.knowledge !== undefined) {
    await hydrateKnowledgeDataset(result.data.knowledge);
  }
}

export function stopRealtimeSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function syncKnowledgeNow(): Promise<SyncResult> {
  return syncEngine.syncNow('knowledge');
}

export async function loadKnowledgeFromServer(): Promise<LoadResult> {
  return syncEngine.loadKnowledgeFromServer();
}
