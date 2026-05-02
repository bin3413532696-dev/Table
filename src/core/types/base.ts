/**
 * 基础类型定义
 * 统一整个项目的数据类型规范
 */

/** 时间戳类型 - 统一使用 number 类型 */
export type Timestamp = number;

/** 实体 ID 类型 */
export type EntityId = string;

/**
 * 基础实体接口
 * 所有数据实体都应继承此接口
 */
export interface BaseEntity {
  id: EntityId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * 统一 CRUD 结果类型
 */
export interface CrudResult<T> {
  success: boolean;
  data?: T;
  error?: AppError;
}

/**
 * 统一查询选项
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// 注意：AppError 在 core/errors 中定义，这里仅做类型引用
import type { AppError } from '../errors';
