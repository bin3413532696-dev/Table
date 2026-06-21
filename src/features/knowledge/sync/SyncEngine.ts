import { SYNC_CONFIG, SyncResult, SyncDataType, SyncStatusSnapshot } from './config';
import { eventEmitter, EventTopics } from '../../../core/events';
import { getKnowledgeMetadata, getNoteList, getPresetTagList } from '../api/notes';

const KNOWLEDGE_CACHE_KEY = 'knowledge_cache_v1';

export type KnowledgeCache = {
  notes: unknown[];
  presetTags: unknown[];
  metadata: {
    noteCount: number;
    presetTagCount: number;
  };
  cachedAt: number;
};

type KnowledgeLoadPayload = {
  notes: unknown[];
  presetTags: unknown[];
  metadata: {
    noteCount: number;
    presetTagCount: number;
  };
};

interface SyncQueueItem {
  type: SyncDataType;
  timestamp: number;
}

class SyncEngineClass {
  private static instance: SyncEngineClass;
  private syncQueue: SyncQueueItem[] = [];
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private lastSyncTime: number | null = null;
  private lastError: string | null = null;
  private retryCount = 0;
  private lastSuccessfulSync: string | null = null;
  private listeners = new Set<() => void>();

  private constructor() {}

  static getInstance(): SyncEngineClass {
    if (!SyncEngineClass.instance) {
      SyncEngineClass.instance = new SyncEngineClass();
    }
    return SyncEngineClass.instance;
  }

  getStatus(): SyncStatusSnapshot {
    return {
      status: this.isSyncing
        ? 'syncing'
        : this.lastError
          ? 'error'
          : this.lastSuccessfulSync
            ? 'success'
            : 'idle',
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      retryCount: this.retryCount,
      lastSuccessfulSync: this.lastSuccessfulSync,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  schedule(type: SyncDataType = 'knowledge'): void {
    this.syncQueue = this.syncQueue.filter((item) => item.type !== type);

    this.syncQueue.push({
      type,
      timestamp: Date.now(),
    });

    this.scheduleProcess();
  }

  async syncNow(type: SyncDataType = 'knowledge'): Promise<SyncResult> {
    return this.performSync([type]);
  }

  private scheduleProcess(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.processQueue();
    }, SYNC_CONFIG.DEBOUNCE_DELAY);
  }

  private async processQueue(): Promise<void> {
    if (this.isSyncing || this.syncQueue.length === 0) return;

    this.isSyncing = true;
    this.notifyListeners();
    eventEmitter.emit(EventTopics.SYNC_STARTED);

    try {
      const mergedTypes = this.getMergedTypes();
      this.syncQueue = [];

      const result = await this.performSync(mergedTypes);

      if (result.success) {
        this.lastSyncTime = result.timestamp || Date.now();
        this.lastError = null;
        this.retryCount = 0;
        this.lastSuccessfulSync = new Date(this.lastSyncTime).toISOString();
        this.notifyListeners();
        eventEmitter.emit(EventTopics.SYNC_COMPLETED);
      } else {
        this.lastError = result.error || 'Unknown error';
        this.retryCount += 1;
        this.notifyListeners();
        eventEmitter.emit(EventTopics.SYNC_FAILED, result.error);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.retryCount += 1;
      this.notifyListeners();
      eventEmitter.emit(EventTopics.SYNC_FAILED, this.lastError);
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  private getMergedTypes(): SyncDataType[] {
    if (this.syncQueue.length === 0) {
      return ['knowledge'];
    }

    return ['knowledge'];
  }

  private async performSync(types: SyncDataType[]): Promise<SyncResult> {
    try {
      if (!types.includes('knowledge')) {
        return {
          success: true,
          timestamp: Date.now(),
        };
      }

      const result = await this.loadKnowledgeFromServer();
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Knowledge sync failed',
        };
      }

      return {
        success: true,
        timestamp: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  private saveKnowledgeCache(data: KnowledgeLoadPayload): void {
    try {
      const cache: KnowledgeCache = {
        ...data,
        cachedAt: Date.now(),
      };
      localStorage.setItem(KNOWLEDGE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore storage errors
    }
  }

  getCachedKnowledgeData(): KnowledgeCache | null {
    try {
      const raw = localStorage.getItem(KNOWLEDGE_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as KnowledgeCache;
    } catch {
      return null;
    }
  }

  async loadKnowledgeFromServer(): Promise<{
    success: boolean;
    data?: KnowledgeLoadPayload;
    error?: string;
  }> {
    try {
      const [notes, presetTags, metadata] = await Promise.all([
        getNoteList(),
        getPresetTagList(),
        getKnowledgeMetadata(),
      ]);

      const data: KnowledgeLoadPayload = {
        notes,
        presetTags,
        metadata: metadata ?? { noteCount: 0, presetTagCount: 0 },
      };

      this.saveKnowledgeCache(data);
      eventEmitter.emit(EventTopics.KNOWLEDGE_SYNCED);

      return {
        success: true,
        data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  async loadKnowledgeMetadata(): Promise<{
    success: boolean;
    data?: {
      noteCount: number;
      presetTagCount: number;
    };
    error?: string;
  }> {
    try {
      return {
        success: true,
        data: await getKnowledgeMetadata(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }
}

export const syncEngine = SyncEngineClass.getInstance();

export function syncKnowledge(): void {
  syncEngine.schedule('knowledge');
}

export function syncKnowledgeNow(): Promise<SyncResult> {
  return syncEngine.syncNow('knowledge');
}

export function loadKnowledgeFromServer() {
  return syncEngine.loadKnowledgeFromServer();
}

export function loadKnowledgeMetadata() {
  return syncEngine.loadKnowledgeMetadata();
}
