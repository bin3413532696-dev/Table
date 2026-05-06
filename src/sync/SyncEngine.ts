/**
 * 统一同步引擎
 * 替代分散在多个文件中的同步逻辑
 */

import { SYNC_CONFIG, SyncStatus, SyncResult, SyncDataType, SyncStatusSnapshot } from './config';
import { eventEmitter, EventTopics } from '../core/events';
import { AppError, ErrorCode } from '../core/errors';
import { fetchWithAuth } from '../lib/auth';

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
      const { getKnowledgeDataset } = await import('../kb');

      const payload: Record<string, unknown> = {};

      for (const type of types) {
        if (type === 'knowledge') {
          payload.knowledge = getKnowledgeDataset();
        }
      }

      if (Object.keys(payload).length === 0) {
        return {
          success: true,
          timestamp: Date.now(),
        };
      }

      const response = await fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_DATASET_WRITE_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: payload.knowledge,
        }),
      });

      if (!response.ok) {
        throw AppError.fromCode(ErrorCode.SYNC_FAILED, `HTTP ${response.status}`);
      }

      const result = await response.json();

      return {
        success: true,
        timestamp: result?.data?.updatedAt || Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 从服务器加载知识库权威数据
   */
  async loadKnowledgeFromServer(): Promise<{
    success: boolean;
    data?: {
      knowledge?: unknown;
    };
    error?: string;
  }> {
    try {
      const response = await fetchWithAuth(SYNC_CONFIG.KNOWLEDGE_DATASET_READ_ENDPOINT);

      if (!response.ok) {
        throw AppError.fromCode(ErrorCode.NETWORK_ERROR, `HTTP ${response.status}`);
      }

      const result = await response.json();

      return {
        success: true,
        data: {
          knowledge: result.data,
        },
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
      updatedAt: number;
      version: number;
      entityCount: number;
      documentCount: number;
      assertionCount: number;
      source: string;
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
