/**
 * 统一同步引擎
 * 替代分散在多个文件中的同步逻辑
 */

import { SYNC_CONFIG, SyncStatus, SyncResult, SyncDataType, SyncStatusSnapshot } from './config';
import { eventEmitter, EventTopics } from '../core/events';
import { AppError, ErrorCode } from '../core/errors';
import { fetchWithAuth } from '../lib/auth';

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

/**
 * 同步队列项
 */
interface SyncQueueItem {
  type: SyncDataType;
  timestamp: number;
}

/**
 * 同步引擎类
 * 单例模式，统一管理所有数据同步
 */
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

  /**
   * 获取同步状态
   */
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

  /**
   * 调度知识库同步
   */
  schedule(type: SyncDataType = 'knowledge'): void {
    // 去重：移除同类型的旧请求
    this.syncQueue = this.syncQueue.filter(item => item.type !== type);

    this.syncQueue.push({
      type,
      timestamp: Date.now(),
    });

    this.scheduleProcess();
  }

  /**
   * 立即同步知识库（跳过防抖）
   */
  async syncNow(type: SyncDataType = 'knowledge'): Promise<SyncResult> {
    return this.performSync([type]);
  }

  private scheduleProcess(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.processQueue();
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

  /**
   * 从服务器加载知识库权威数据
   */
  async loadKnowledgeFromServer(): Promise<{
    success: boolean;
    data?: KnowledgeLoadPayload;
    error?: string;
  }> {
    try {
      const [notesResponse, presetTagsResponse, metadataResponse] = await Promise.all([
        fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_NOTES_ENDPOINT),
        fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_PRESET_TAGS_ENDPOINT),
        fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_METADATA_ENDPOINT),
      ]);

      if (!notesResponse.ok) {
        throw AppError.fromCode(ErrorCode.NETWORK_ERROR, `HTTP ${notesResponse.status}`);
      }
      if (!presetTagsResponse.ok) {
        throw AppError.fromCode(ErrorCode.NETWORK_ERROR, `HTTP ${presetTagsResponse.status}`);
      }
      if (!metadataResponse.ok) {
        throw AppError.fromCode(ErrorCode.NETWORK_ERROR, `HTTP ${metadataResponse.status}`);
      }

      const [notesResult, presetTagsResult, metadataResult] = await Promise.all([
        notesResponse.json(),
        presetTagsResponse.json(),
        metadataResponse.json(),
      ]);

      const data: KnowledgeLoadPayload = {
        notes: Array.isArray(notesResult?.items) ? notesResult.items : [],
        presetTags: Array.isArray(presetTagsResult?.items) ? presetTagsResult.items : [],
        metadata: metadataResult?.data ?? { noteCount: 0, presetTagCount: 0 },
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
      const response = await fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_METADATA_ENDPOINT);

      if (!response.ok) {
        throw AppError.fromCode(ErrorCode.NETWORK_ERROR, `HTTP ${response.status}`);
      }

      const result = await response.json();

      return {
        success: true,
        data: result.data,
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

/**
 * 便捷函数：调度知识库同步
 */
export function syncKnowledge(): void {
  syncEngine.schedule('knowledge');
}

/**
 * 便捷函数：立即同步知识库数据
 */
export function syncKnowledgeNow(): Promise<SyncResult> {
  return syncEngine.syncNow('knowledge');
}

/**
 * 便捷函数：加载知识库权威数据
 */
export function loadKnowledgeFromServer() {
  return syncEngine.loadKnowledgeFromServer();
}

export function loadKnowledgeMetadata() {
  return syncEngine.loadKnowledgeMetadata();
}
