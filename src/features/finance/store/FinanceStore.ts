import { BaseStore, StoreConfig } from '../../../shared/store';
import { FinanceRecord, CreateFinanceDTO, UpdateFinanceDTO, FinanceStats, ModelStats } from '../../../core/types';
import { EventTopics } from '../../../core/events';
import { isValidFinanceRecord, isValidCreateFinanceDTO } from '../../../core/validation';

const FINANCE_STORE_CONFIG: StoreConfig = {
  storageKey: 'finance_cache_disabled',
  typeName: 'FinanceRecord',
  autoSync: true,
};

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

  async getStats(): Promise<FinanceStats> {
    const records = await this.getAll();
    const income = records
      .filter((record) => record.type === 'income')
      .reduce((sum, record) => sum + record.amount, 0);
    const expense = records
      .filter((record) => record.type === 'expense')
      .reduce((sum, record) => sum + record.amount, 0);

    return {
      income,
      expense,
      profit: income - expense,
    };
  }

  async getModelStats(): Promise<Record<string, ModelStats>> {
    const records = await this.getAll();
    const stats: Record<string, ModelStats> = {};

    records.forEach((record) => {
      const model = record.model || '其他';
      if (!stats[model]) {
        stats[model] = { expense: 0, income: 0 };
      }
      if (record.type === 'expense') {
        stats[model].expense += record.amount;
      } else {
        stats[model].income += record.amount;
      }
    });

    return stats;
  }

  async filter(options: {
    type?: 'income' | 'expense' | 'all';
    category?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<FinanceRecord[]> {
    let records = await this.getAll();

    if (options.type && options.type !== 'all') {
      records = records.filter((record) => record.type === options.type);
    }

    if (options.category) {
      records = records.filter((record) => record.category === options.category);
    }

    if (options.startDate) {
      records = records.filter((record) => record.date >= options.startDate!);
    }

    if (options.endDate) {
      records = records.filter((record) => record.date <= options.endDate!);
    }

    if (options.limit) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  hydrate(records: FinanceRecord[], emit = false): void {
    this.data = records.filter((record) => this.validate(record));
    if (emit) {
      import('../../../core/events').then(({ emitDataChange }) => {
        emitDataChange('finance');
      });
    }
  }

  replaceAll(records: FinanceRecord[]): void {
    this.hydrate(records, true);
  }
}

export const financeStore = new FinanceStoreClass();
