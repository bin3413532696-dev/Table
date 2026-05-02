/**
 * Store 类型定义
 */

import { BaseEntity, EntityId, CrudResult } from '../../core/types';

/**
 * Store 接口
 * 统一所有 Store 的 API
 */
export interface IStore<T extends BaseEntity, CreateDTO, UpdateDTO> {
  /** 获取所有实体 */
  getAll(): Promise<T[]>;

  /** 按 ID 获取实体 */
  getById(id: EntityId): Promise<T | undefined>;

  /** 创建实体 - 统一使用 create */
  create(data: CreateDTO): Promise<CrudResult<T>>;

  /** 更新实体 */
  update(id: EntityId, data: UpdateDTO): Promise<CrudResult<T>>;

  /** 删除实体 */
  delete(id: EntityId): Promise<CrudResult<void>>;

  /** 获取数量 */
  count(): Promise<number>;
}

/**
 * Store 配置
 */
export interface StoreConfig {
  /** 存储键名 */
  storageKey: string;

  /** 数据类型名称 */
  typeName: string;

  /** 是否自动同步 */
  autoSync?: boolean;
}

/**
 * 增量更新结果
 */
export interface IncrementalUpdate<T> {
  added: T[];
  updated: T[];
  removed: EntityId[];
}