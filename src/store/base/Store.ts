/**
 * 抽象 Store 基类
 * 统一所有数据存储的实现
 */

import { BaseEntity, EntityId, CrudResult } from '../../core/types';
import { EventTopics, eventEmitter } from '../../core/events';
import { AppError, ErrorCode, errorHandler } from '../../core/errors';
import { syncEngine } from '../../sync';
import { IStore, StoreConfig } from './types';

/**
 * ID 生成计数器
 */
let idCounter = 0;

/**
 * 生成统一格式的 ID
 */
export function generateId(): EntityId {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  idCounter = (idCounter + 1) % 1000;
  const counter = idCounter.toString(36).padStart(3, '0');
  return `${timestamp}-${random}-${counter}`;
}

/**
 * 抽象 Store 基类
 * 所有具体 Store 都应继承此类
 */
export abstract class BaseStore<T extends BaseEntity, CreateDTO, UpdateDTO>
  implements IStore<T, CreateDTO, UpdateDTO> {

  protected abstract readonly config: StoreConfig;
  protected abstract readonly changeTopic: typeof EventTopics[keyof typeof EventTopics];

  protected data: T[] = [];
  private initialized = false;

  constructor() {
    this.initialize();
  }

  /**
   * 初始化数据
   */
  protected initialize(): void {
    this.data = this.loadFromStorage();
    this.initialized = true;
  }

  /**
   * 从存储加载数据 - 子类实现
   */
  protected abstract loadFromStorage(): T[];

  /**
   * 保存数据到存储 - 子类实现
   */
  protected abstract saveToStorage(data: T[]): void;

  /**
   * 验证实体 - 子类实现
   */
  protected abstract validate(entity: unknown): entity is T;

  /**
   * 验证创建 DTO - 子类实现
   */
  protected abstract validateCreateDTO(dto: unknown): dto is CreateDTO;

  /**
   * 获取所有实体
   */
  async getAll(): Promise<T[]> {
    return [...this.data];
  }

  /**
   * 按 ID 获取实体
   */
  async getById(id: EntityId): Promise<T | undefined> {
    return this.data.find(item => item.id === id);
  }

  /**
   * 创建实体
   */
  async create(dto: CreateDTO): Promise<CrudResult<T>> {
    try {
      if (!this.validateCreateDTO(dto)) {
        return {
          success: false,
          error: AppError.fromCode(ErrorCode.VALIDATION_FAILED, this.config.typeName),
        };
      }

      const now = Date.now();
      const entity = {
        ...dto,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      } as unknown as T;

      this.data = [entity, ...this.data];
      this.persist();

      return { success: true, data: entity };
    } catch (error) {
      return {
        success: false,
        error: errorHandler.handle(error, `${this.config.typeName}.create`),
      };
    }
  }

  /**
   * 更新实体
   */
  async update(id: EntityId, dto: UpdateDTO): Promise<CrudResult<T>> {
    try {
      const index = this.data.findIndex(item => item.id === id);
      if (index === -1) {
        return {
          success: false,
          error: AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id),
        };
      }

      const updated = {
        ...this.data[index],
        ...dto,
        updatedAt: Date.now(),
      };

      if (!this.validate(updated)) {
        return {
          success: false,
          error: AppError.fromCode(ErrorCode.VALIDATION_FAILED, this.config.typeName),
        };
      }

      this.data[index] = updated;
      this.persist();

      return { success: true, data: updated };
    } catch (error) {
      return {
        success: false,
        error: errorHandler.handle(error, `${this.config.typeName}.update`),
      };
    }
  }

  /**
   * 删除实体
   */
  async delete(id: EntityId): Promise<CrudResult<void>> {
    try {
      const index = this.data.findIndex(item => item.id === id);
      if (index === -1) {
        return {
          success: false,
          error: AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id),
        };
      }

      this.data.splice(index, 1);
      this.persist();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: errorHandler.handle(error, `${this.config.typeName}.delete`),
      };
    }
  }

  /**
   * 获取数量
   */
  async count(): Promise<number> {
    return this.data.length;
  }

  /**
   * 批量替换（用于导入）
   */
  replaceAll(entities: T[]): void {
    this.data = entities.filter(e => this.validate(e));
    this.saveToStorage(this.data);
    this.persist();
  }

  /**
   * 获取原始数据（内部使用）
   */
  protected getRawData(): T[] {
    return this.data;
  }

  /**
   * 设置数据（内部使用，用于兼容层）
   */
  protected setData(data: T[]): void {
    this.data = data;
  }

  /**
   * 持久化 + 触发事件 + 调度同步
   */
  protected persist(): void {
    this.saveToStorage(this.data);
    eventEmitter.emit(this.changeTopic);
    if (this.config.autoSync !== false) {
      syncEngine.schedule(this.getSyncType());
    }
  }

  /**
   * 获取同步类型
   */
  protected getSyncType(): 'finance' | 'tasks' | 'notes' {
    switch (this.changeTopic) {
      case EventTopics.FINANCE_CHANGED:
        return 'finance';
      case EventTopics.TASKS_CHANGED:
        return 'tasks';
      case EventTopics.NOTES_CHANGED:
        return 'notes';
      default:
        return 'notes';
    }
  }
}
