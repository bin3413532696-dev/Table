/**
 * 任务存储实现
 */

import { BaseStore } from '../base/Store';
import { StoreConfig } from '../base/types';
import { Task, CreateTaskDTO, UpdateTaskDTO, TaskStats } from '../../core/types';
import { EventTopics } from '../../core/events';
import { isValidTask, isValidCreateTaskDTO } from '../../core/validation';

/**
 * 任务存储配置
 */
const TASK_STORE_CONFIG: StoreConfig = {
  storageKey: 'tasks_records',
  typeName: 'Task',
  autoSync: true,
};

/**
 * 任务存储类
 */
class TaskStoreClass extends BaseStore<Task, CreateTaskDTO, UpdateTaskDTO> {
  protected readonly config = TASK_STORE_CONFIG;
  protected readonly changeTopic = EventTopics.TASKS_CHANGED;

  protected loadFromStorage(): Task[] {
    try {
      const config = this.config;
      if (!config) return [];
      
      const data = localStorage.getItem(config.storageKey);
      if (!data) return [];

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(isValidTask);
    } catch {
      console.warn(`[TaskStore] Failed to load from storage`);
      return [];
    }
  }

  protected saveToStorage(data: Task[]): void {
    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.error(`[${this.config.typeName}] Storage quota exceeded`);
        import('../../core/events').then(({ eventEmitter, EventTopics }) => {
          eventEmitter.emit(EventTopics.STORAGE_QUOTA_EXCEEDED);
        });
      }
      throw error;
    }
  }

  protected validate(entity: unknown): entity is Task {
    return isValidTask(entity);
  }

  protected validateCreateDTO(dto: unknown): dto is CreateTaskDTO {
    return isValidCreateTaskDTO(dto);
  }

  /**
   * 获取任务统计
   */
  async getStats(): Promise<TaskStats> {
    const tasks = await this.getAll();
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;

    return {
      total,
      completed,
      pending: total - completed,
    };
  }

  /**
   * 切换任务完成状态
   */
  async toggle(id: string): Promise<{ success: boolean; error?: import('../../core/errors').AppError }> {
    const task = await this.getById(id);
    if (!task) {
      return {
        success: false,
        error: import('../../core/errors').then(({ AppError, ErrorCode }) =>
          AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id)
        ) as any,
      };
    }

    const result = await this.update(id, { completed: !task.completed });
    return { success: result.success, error: result.error };
  }

  /**
   * 按条件筛选
   */
  async filter(options: {
    completed?: boolean;
    priority?: 'low' | 'medium' | 'high';
    limit?: number;
  }): Promise<Task[]> {
    let tasks = await this.getAll();

    if (options.completed !== undefined) {
      tasks = tasks.filter(t => t.completed === options.completed);
    }

    if (options.priority) {
      tasks = tasks.filter(t => t.priority === options.priority);
    }

    if (options.limit) {
      tasks = tasks.slice(0, options.limit);
    }

    return tasks;
  }

  hydrate(tasks: Task[], emit = false): void {
    this.data = tasks.filter(t => this.validate(t));
    this.saveToStorage(this.data);
    if (emit) {
      import('../../core/events').then(({ emitDataChange }) => {
        emitDataChange('tasks');
      });
    }
  }

  /**
   * 批量替换所有数据（用于导入）
   */
  replaceAll(tasks: Task[]): void {
    this.hydrate(tasks, true);
  }
}

/**
 * 任务存储实例
 */
export const taskStore = new TaskStoreClass();
