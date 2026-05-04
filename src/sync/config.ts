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

  /** 知识库 metadata 端点 */
  KNOWLEDGE_METADATA_ENDPOINT: '/api/knowledge/metadata',

  /** 知识库 metadata 轮询间隔 */
  KNOWLEDGE_POLL_INTERVAL: 3000,
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

/**
 * 当前同步层仅承担知识库权威同步。
 */
export type SyncDataType = 'knowledge';
