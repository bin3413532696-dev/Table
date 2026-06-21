/**
 * 任务相关类型定义
 */

import { BaseEntity } from './base';

/** 任务优先级 */
export type TaskPriority = 'low' | 'medium' | 'high';

/**
 * 任务实体
 */
export interface Task extends BaseEntity {
  title: string;
  completed: boolean;
  priority: TaskPriority;
  dueDate?: string; // ISO 日期格式 YYYY-MM-DD
}

/**
 * 创建任务 DTO
 */
export interface CreateTaskDTO {
  title: string;
  completed?: boolean;
  priority?: TaskPriority;
  dueDate?: string;
}

/**
 * 更新任务 DTO
 */
export type UpdateTaskDTO = Partial<CreateTaskDTO>;

/**
 * 任务统计结果
 */
export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
}
