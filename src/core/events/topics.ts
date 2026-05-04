/**
 * 事件主题定义
 * 统一所有事件的命名和分类
 */

/**
 * 事件主题接口
 */
export interface EventTopic {
  key: string;
  description?: string;
}

/**
 * 预定义事件主题
 * 替代原有的三套独立订阅系统
 */
export const EventTopics = {
  // 数据变更事件
  FINANCE_CHANGED: { key: 'finance:changed', description: '财务数据变更' },
  TASKS_CHANGED: { key: 'tasks:changed', description: '任务数据变更' },

  // 同步事件
  SYNC_STARTED: { key: 'sync:started', description: '同步开始' },
  SYNC_COMPLETED: { key: 'sync:completed', description: '同步完成' },
  SYNC_FAILED: { key: 'sync:failed', description: '同步失败' },

  // 存储事件
  STORAGE_QUOTA_EXCEEDED: { key: 'storage:quota', description: '存储空间不足' },
  STORAGE_ERROR: { key: 'storage:error', description: '存储错误' },

  // 错误事件
  ERROR_OCCURRED: { key: 'error:occurred', description: '错误发生' },
} as const;

/**
 * 数据变更主题映射
 */
export const DataChangeTopics = {
  finance: EventTopics.FINANCE_CHANGED,
  tasks: EventTopics.TASKS_CHANGED,
} as const;

export type DataType = keyof typeof DataChangeTopics;