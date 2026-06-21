import { financeApi } from '../features/finance/public';
import { syncEngine, type LoadResult, type SyncResult, type SyncStatus } from '../features/knowledge/public';
import { taskApi } from '../features/tasks/public';

export type { SyncStatus, SyncResult, LoadResult };

export function getSyncStatus() {
  return syncEngine.getStatus();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  return syncEngine.subscribe(listener);
}

export async function initializeAppData(): Promise<boolean> {
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
