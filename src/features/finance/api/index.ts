import { AppError, ErrorCode, errorHandler } from '../../../core/errors';
import type { FinanceRecord } from '../../../core/types';
import { isValidFinanceRecord } from '../../../core/validation';
import { financeStore } from '../store';
import { syncEngine } from '../../knowledge/public';
import { ApiListResponse, requestApi, requestApiData } from '../../../shared/api/client';

async function refreshKnowledgeCache(): Promise<void> {
  const result = await syncEngine.loadKnowledgeFromServer();

  if (!result.success) {
    console.warn('[Finance API] Failed to refresh knowledge cache:', result.error);
  }
}

function sortFinanceRecords(items: FinanceRecord[]): FinanceRecord[] {
  return [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function normalizeFinancePayload(record: unknown): unknown {
  if (typeof record !== 'object' || record === null) {
    return record;
  }

  const normalized: Record<string, unknown> = { ...(record as Record<string, unknown>) };

  if (normalized.model === null) {
    delete normalized.model;
  }

  return normalized;
}

function assertValidFinanceRecord(record: unknown, context: string): FinanceRecord {
  const normalizedRecord = normalizeFinancePayload(record);

  if (!isValidFinanceRecord(normalizedRecord)) {
    throw errorHandler.handle(
      AppError.fromCode(ErrorCode.INVALID_DATA, 'Invalid finance payload from server'),
      context
    );
  }

  return normalizedRecord;
}

async function loadFinanceRecords(emit = false): Promise<FinanceRecord[]> {
  const response = await requestApi<ApiListResponse<FinanceRecord>>('/api/finance/');
  const records = sortFinanceRecords(
    response.items
      .map((item) => normalizeFinancePayload(item))
      .filter(isValidFinanceRecord)
  );

  financeStore.hydrate(records, emit);
  return records;
}

export const financeApi = {
  async getAll(): Promise<FinanceRecord[]> {
    return loadFinanceRecords(false);
  },

  async refresh(): Promise<FinanceRecord[]> {
    return loadFinanceRecords(true);
  },

  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    const created = assertValidFinanceRecord(
      await requestApiData<FinanceRecord>('/api/finance/', {
        method: 'POST',
        body: JSON.stringify({
          type: record.type,
          amount: Number(record.amount),
          description: record.description,
          category: record.category,
          date: record.date,
          model: record.model || undefined,
        }),
      }),
      'finance.add'
    );

    const snapshot = await financeStore.getAll();
    const next = sortFinanceRecords([created, ...snapshot.filter((item) => item.id !== created.id)]);
    financeStore.hydrate(next, true);
    void refreshKnowledgeCache();
    return created;
  },

  async update(id: string, updates: Partial<FinanceRecord> & { version: number }): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (updates.type !== undefined) payload.type = updates.type;
    if (updates.amount !== undefined) payload.amount = Number(updates.amount);
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.date !== undefined) payload.date = updates.date;
    if (updates.model !== undefined) payload.model = updates.model;
    if (updates.version !== undefined) payload.version = updates.version;

    const updated = assertValidFinanceRecord(
      await requestApiData<FinanceRecord>(`/api/finance/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
      'finance.update'
    );

    const snapshot = await financeStore.getAll();
    const next = sortFinanceRecords(snapshot.map((item) => (item.id === id ? updated : item)));
    financeStore.hydrate(next, true);
    void refreshKnowledgeCache();
  },

  async delete(id: string): Promise<void> {
    await requestApi<void>(`/api/finance/${id}`, {
      method: 'DELETE',
    });

    const snapshot = await financeStore.getAll();
    financeStore.hydrate(snapshot.filter((item) => item.id !== id), true);
    void refreshKnowledgeCache();
  },

  async getStats(): Promise<{ income: number; expense: number; profit: number }> {
    const records = await financeStore.getAll();
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
  },
};
