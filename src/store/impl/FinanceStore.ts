/**
 * 财务存储实现
 */

import { BaseStore } from '../base/Store';
import { StoreConfig } from '../base/types';
import { FinanceRecord, CreateFinanceDTO, UpdateFinanceDTO, FinanceStats, ModelStats } from '../../core/types';
import { EventTopics } from '../../core/events';
import { isValidFinanceRecord, isValidCreateFinanceDTO } from '../../core/validation';

/**
 * 财务存储配置
 */
const FINANCE_STORE_CONFIG: StoreConfig = {
  storageKey: 'finance_cache_disabled',
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
    return [];
  }

  protected saveToStorage(data: FinanceRecord[]): void {
    void data;
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

  hydrate(records: FinanceRecord[], emit = false): void {
    this.data = records.filter(r => this.validate(r));
    if (emit) {
      import('../../core/events').then(({ emitDataChange }) => {
        emitDataChange('finance');
      });
    }
  }

  /**
   * 批量替换所有数据（用于导入）
   */
  replaceAll(records: FinanceRecord[]): void {
    this.hydrate(records, true);
  }
}

/**
 * 财务存储实例
 */
export const financeStore = new FinanceStoreClass();
