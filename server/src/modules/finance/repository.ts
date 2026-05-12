import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateFinanceRecordInput, UpdateFinanceRecordInput } from './schema';

export async function listFinanceRecords() {
  return prisma.financeRecord.findMany({
    where: {
      userId: getCurrentUserId(),
      deletedAt: null,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
}

export async function createFinanceRecord(input: CreateFinanceRecordInput) {
  return prisma.financeRecord.create({
    data: {
      userId: getCurrentUserId(),
      type: input.type,
      amount: input.amount,
      category: input.category,
      description: input.description,
      recordDate: new Date(input.date ?? input.recordDate ?? ''),
      model: input.model ?? null,
    },
  });
}

export async function findFinanceRecordById(id: string) {
  return prisma.financeRecord.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
      deletedAt: null,
    },
  });
}

export async function updateFinanceRecord(id: string, input: UpdateFinanceRecordInput) {
  return prisma.financeRecord.updateManyAndReturn({
    where: {
      id,
      userId: getCurrentUserId(),
      deletedAt: null,
      version: input.version,
    },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.date !== undefined || input.recordDate !== undefined
        ? { recordDate: new Date(input.date ?? input.recordDate ?? '') }
        : {}),
      ...(input.model !== undefined ? { model: input.model ?? null } : {}),
      version: {
        increment: 1,
      },
    },
  }).then((records) => records[0] ?? null);
}

export async function softDeleteFinanceRecord(id: string) {
  return prisma.financeRecord.update({
    where: { id, userId: getCurrentUserId() },
    data: {
      deletedAt: new Date(),
      version: {
        increment: 1,
      },
    },
  });
}
