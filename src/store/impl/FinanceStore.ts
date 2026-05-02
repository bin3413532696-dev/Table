/**
 * 财务存储实现
 */

import { BaseStore, generateId } from '../base/Store';
import { StoreConfig } from '../base/types';
import { FinanceRecord, CreateFinanceDTO, UpdateFinanceDTO, FinanceStats, ModelStats } from '../../core/types';
import { EventTopics } from '../../core/events';
import { isValidFinanceRecord, isValidCreateFinanceDTO } from '../../core/validation';

/**
 * 财务存储配置
 */
const FINANCE_STORE_CONFIG: StoreConfig = {
  storageKey: 'finance_records',
  typeName: 'FinanceRecord',
  autoSync: true,
};

/**
 * 财务存储类
 */
class FinanceStoreClass extends BaseStore<FinanceRecord, CreateFinanceDTO, UpdateFinanceDTO> {
  protected readonly config = FINANCE_STORE_CONFIG;
  protected readonly changeTopic = EventTopics.FINANCE_CHANGED;

  protected loadFromStorage(): FinanceRecord[] {
    try {
      const config = this.config;
      if (!config) return [];
      
      const data = localStorage.getItem(config.storageKey);
      if (!data) return [];

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];

      // 过滤并验证有效记录
      return parsed.filter(isValidFinanceRecord);
    } catch {
      console.warn(`[FinanceStore] Failed to load from storage`);
      return [];
    }
  }

  protected saveToStorage(data: FinanceRecord[]): void {
    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.error(`[${this.config.typeName}] Storage quota exceeded`);
        // 触发存储配额事件
        import('../../core/events').then(({ eventEmitter, EventTopics }) => {
          eventEmitter.emit(EventTopics.STORAGE_QUOTA_EXCEEDED);
        });
      }
      throw error;
    }
  }

  protected validate(entity: unknown): entity is FinanceRecord {
    return isValidFinanceRecord(entity);
  }

  protected validateCreateDTO(dto: unknown): dto is CreateFinanceDTO {
    return isValidCreateFinanceDTO(dto);
  }

  /**
   * 获取财务统计
   */
  async getStats(): Promise<FinanceStats> {
    const records = await this.getAll();
    const income = records
      .filter(r => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0);
    const expense = records
      .filter(r => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      income,
      expense,
      profit: income - expense,
    };
  }

  /**
   * 按模型统计
   */
  async getModelStats(): Promise<Record<string, ModelStats>> {
    const records = await this.getAll();
    const stats: Record<string, ModelStats> = {};

    records.forEach(r => {
      const model = r.model || '其他';
      if (!stats[model]) {
        stats[model] = { expense: 0, income: 0 };
      }
      if (r.type === 'expense') {
        stats[model].expense += r.amount;
      } else {
        stats[model].income += r.amount;
      }
    });

    return stats;
  }

  /**
   * 按条件筛选
   */
  async filter(options: {
    type?: 'income' | 'expense' | 'all';
    category?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<FinanceRecord[]> {
    let records = await this.getAll();

    if (options.type && options.type !== 'all') {
      records = records.filter(r => r.type === options.type);
    }

    if (options.category) {
      records = records.filter(r => r.category === options.category);
    }

    if (options.startDate) {
      records = records.filter(r => r.date >= options.startDate!);
    }

    if (options.endDate) {
      records = records.filter(r => r.date <= options.endDate!);
    }

    if (options.limit) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  /**
   * 批量替换所有数据（用于导入）
   */
  replaceAll(records: FinanceRecord[]): void {
    this.data = records.filter(r => this.validate(r));
    this.saveToStorage(this.data);
    this.persist();
  }
}

/**
 * 财务存储实例
 */
export const financeStore = new FinanceStoreClass();