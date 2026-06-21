import { BaseStore, StoreConfig } from '../../../shared/store';
import { Task, CreateTaskDTO, UpdateTaskDTO, TaskStats } from '../../../core/types';
import { EventTopics } from '../../../core/events';
import { AppError, ErrorCode } from '../../../core/errors';
import { isValidTask, isValidCreateTaskDTO } from '../../../core/validation';

const TASK_STORE_CONFIG: StoreConfig = {
  storageKey: 'tasks_cache_disabled',
  typeName: 'Task',
  autoSync: true,
};

class TaskStoreClass extends BaseStore<Task, CreateTaskDTO, UpdateTaskDTO> {
  protected readonly config = TASK_STORE_CONFIG;
  protected readonly changeTopic = EventTopics.TASKS_CHANGED;

  protected loadFromStorage(): Task[] {
    return [];
  }

  protected saveToStorage(data: Task[]): void {
    void data;
  }

  protected validate(entity: unknown): entity is Task {
    return isValidTask(entity);
  }

  protected validateCreateDTO(dto: unknown): dto is CreateTaskDTO {
    return isValidCreateTaskDTO(dto);
  }

  async getStats(): Promise<TaskStats> {
    const tasks = await this.getAll();
    const total = tasks.length;
    const completed = tasks.filter((task) => task.completed).length;

    return {
      total,
      completed,
      pending: total - completed,
    };
  }

  async toggle(id: string): Promise<{ success: boolean; error?: AppError }> {
    const task = await this.getById(id);
    if (!task) {
      return {
        success: false,
        error: AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id),
      };
    }

    const result = await this.update(id, { completed: !task.completed });
    return { success: result.success, error: result.error };
  }

  async filter(options: {
    completed?: boolean;
    priority?: 'low' | 'medium' | 'high';
    limit?: number;
  }): Promise<Task[]> {
    let tasks = await this.getAll();

    if (options.completed !== undefined) {
      tasks = tasks.filter((task) => task.completed === options.completed);
    }

    if (options.priority) {
      tasks = tasks.filter((task) => task.priority === options.priority);
    }

    if (options.limit) {
      tasks = tasks.slice(0, options.limit);
    }

    return tasks;
  }

  hydrate(tasks: Task[], emit = false): void {
    this.data = tasks.filter((task) => this.validate(task));
    if (emit) {
      import('../../../core/events').then(({ emitDataChange }) => {
        emitDataChange('tasks');
      });
    }
  }

  replaceAll(tasks: Task[]): void {
    this.hydrate(tasks, true);
  }
}

export const taskStore = new TaskStoreClass();
