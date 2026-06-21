export const SYNC_CONFIG = {
  DEBOUNCE_DELAY: 1500,
  MAX_RETRY_COUNT: 3,
  RETRY_BASE_DELAY: 1000,
  KNOWLEDGE_NOTES_ENDPOINT: '/api/knowledge/notes',
  KNOWLEDGE_PRESET_TAGS_ENDPOINT: '/api/knowledge/tags/preset',
  KNOWLEDGE_METADATA_ENDPOINT: '/api/knowledge/metadata',
  KNOWLEDGE_POLL_INTERVAL: 3000,
} as const;

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncResult {
  success: boolean;
  timestamp?: number;
  error?: string;
}

export interface LoadResult {
  success: boolean;
  data?: {
    knowledge?: unknown;
  };
  error?: string;
}

export interface SyncStatusSnapshot {
  status: SyncStatus;
  lastSyncTime: number | null;
  lastError: string | null;
  retryCount: number;
  lastSuccessfulSync: string | null;
}

export type SyncDataType = 'knowledge';
