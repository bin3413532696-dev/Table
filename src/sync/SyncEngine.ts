/**
 * 统一同步引擎
 * 替代分散在多个文件中的同步逻辑
 */

import { SYNC_CONFIG, SyncStatus, SyncResult, SyncDataType } from './config';
import { eventEmitter, EventTopics } from '../core/events';
import { AppError, ErrorCode } from '../core/errors';

/**
 * 同步队列项
 */
interface SyncQueueItem {
  type: SyncDataType;
  timestamp: number;
  retryCount: number;
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
  getStatus(): { status: SyncStatus; lastSyncTime: number | null; lastError: string | null } {
    return {
      status: this.isSyncing ? 'syncing' : (this.lastError ? 'error' : 'idle'),
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
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
      retryCount: 0,
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
    eventEmitter.emit(EventTopics.SYNC_STARTED);

    try {
      const mergedTypes = this.getMergedTypes();
      this.syncQueue = [];

      const result = await this.performSync(mergedTypes);

      if (result.success) {
        this.lastSyncTime = result.timestamp || Date.now();
        this.lastError = null;
        eventEmitter.emit(EventTopics.SYNC_COMPLETED);
      } else {
        this.lastError = result.error || 'Unknown error';
        eventEmitter.emit(EventTopics.SYNC_FAILED, result.error);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      eventEmitter.emit(EventTopics.SYNC_FAILED, this.lastError);
    } finally {
      this.isSyncing = false;
    }
  }

  private getMergedTypes(): SyncDataType[] {
    const types = new Set(this.syncQueue.map(item => item.type));
    if (types.has('all')) return ['all'];
    return Array.from(types) as SyncDataType[];
  }

  private async performSync(types: SyncDataType[]): Promise<SyncResult> {
    try {
      // 动态导入 Store 实现以避免循环依赖
      const { financeStore, taskStore, noteStore } = await import('../store/impl');

      const payload: Record<string, unknown> = {};

      for (const type of types) {
        if (type === 'all' || type === 'finance') {
          payload.finance = await financeStore.getAll();
        }
        if (type === 'all' || type === 'tasks') {
          payload.tasks = await taskStore.getAll();
        }
        if (type === 'all' || type === 'notes') {
          payload.notes = await noteStore.getAll();
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
      notes: unknown[];
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
 * 便捷函数：同步笔记数据
 */
export function syncNotes(): void {
  syncEngine.schedule('notes');
}