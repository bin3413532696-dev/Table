/**
 * 统一同步引擎
 * 替代分散在多个文件中的同步逻辑
 */

import { SYNC_CONFIG, SyncStatus, SyncResult, SyncDataType, SyncStatusSnapshot } from './config';
import { eventEmitter, EventTopics } from '../core/events';
import { AppError, ErrorCode } from '../core/errors';

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
   * 调度同步
   */
  schedule(type: SyncDataType = 'all'): void {
    // 去重：移除同类型的旧请求
    this.syncQueue = this.syncQueue.filter(item => item.type !== type);

    this.syncQueue.push({
      type,
      timestamp: Date.now(),
    });

    this.scheduleProcess();
  }

  /**
   * 立即同步（跳过防抖）
   */
  async syncNow(type: SyncDataType = 'all'): Promise<SyncResult> {
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
    const types = new Set(this.syncQueue.map(item => item.type));
    if (types.has('all')) return ['all'];
    return Array.from(types) as SyncDataType[];
  }

  private async performSync(types: SyncDataType[]): Promise<SyncResult> {
    try {
      // 动态导入 Store 实现以避免循环依赖
      const { financeStore, taskStore } = await import('../store/impl');
      const { getKnowledgeDataset } = await import('../kb');

      const payload: Record<string, unknown> = {};

      for (const type of types) {
        if (type === 'all' || type === 'finance') {
          payload.finance = await financeStore.getAll();
        }
        if (type === 'all' || type === 'tasks') {
          payload.tasks = await taskStore.getAll();
        }
        if (type === 'all' || type === 'knowledge') {
          payload.knowledge = getKnowledgeDataset();
        }
      }

      const response = await fetch(SYNC_CONFIG.SYNC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw AppError.fromCode(ErrorCode.SYNC_FAILED, `HTTP ${response.status}`);
      }

      const result = await response.json();

      return {
        success: true,
        timestamp: result.timestamp || Date.now(),
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
   * 从服务器加载数据
   */
  async loadFromServer(): Promise<{
    success: boolean;
    data?: {
      finance: unknown[];
      tasks: unknown[];
      knowledge?: unknown;
    };
    error?: string;
  }> {
    try {
      const response = await fetch(SYNC_CONFIG.LOAD_ENDPOINT);

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
 * 便捷函数：同步所有数据
 */
export function syncAll(): Promise<SyncResult> {
  return syncEngine.syncNow('all');
}

/**
 * 便捷函数：同步财务数据
 */
export function syncFinance(): void {
  syncEngine.schedule('finance');
}

/**
 * 便捷函数：同步任务数据
 */
export function syncTasks(): void {
  syncEngine.schedule('tasks');
}

/**
 * 便捷函数：同步知识库数据
 */
export function syncKnowledge(): void {
  syncEngine.schedule('knowledge');
}
