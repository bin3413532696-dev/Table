import type { FinanceRecord } from '@prisma/client';
import { toTimestamp, toDateOnly } from '../../shared/date';

export function toFinanceRecordDto(record: FinanceRecord) {
  return {
    id: record.id,
    type: record.type as 'income' | 'expense',
    amount: Number(record.amount),
    description: record.description,
    category: record.category,
    date: toDateOnly(record.recordDate),
    model: record.model ?? undefined,
    createdAt: toTimestamp(record.createdAt),
    updatedAt: toTimestamp(record.updatedAt),
    version: record.version,
  };
}
