import type { FinanceRecord } from '@prisma/client';

function toTimestamp(value: Date): number {
  return value.getTime();
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

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
  };
}
