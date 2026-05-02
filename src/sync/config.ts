/**
 * 同步配置
 * 统一所有同步相关常量
 */

/**
 * 同步配置常量
 */
export const SYNC_CONFIG = {
  /** 防抖延迟 - 统一为 1500ms */
  DEBOUNCE_DELAY: 1500,

  /** 最大重试次数 */
  MAX_RETRY_COUNT: 3,

  /** 重试基础延迟（指数退避） */
  RETRY_BASE_DELAY: 1000,

  /** 同步 API 端点 */
  SYNC_ENDPOINT: '/api/sync-data',

  /** 加载数据端点 */
  LOAD_ENDPOINT: '/api/load-data',
} as const;

/**
 * 同步状态类型
 */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

/**
 * 同步结果类型
 */
export interface SyncResult {
  success: boolean;
  timestamp?: number;
  error?: string;
}

/**
 * 同步数据类型
 */
export type SyncDataType = 'finance' | 'tasks' | 'notes' | 'all';