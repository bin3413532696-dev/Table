import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateFinanceRecordInput, UpdateFinanceRecordInput } from './schema';
import {
  enqueueProjectionOutboxEvent,
  KNOWLEDGE_PROJECTION_TOPIC,
  toProjectionPayload,
} from '../projection/outbox';

function toFinanceProjectionPayload(record: {
  id: string;
  type: string;
  amount: { toString(): string };
  description: string;
  category: string;
  recordDate: Date;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    type: record.type,
    amount: Number(record.amount),
    description: record.description,
    category: record.category,
    date: record.recordDate.toISOString().slice(0, 10),
    model: record.model ?? undefined,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  };
}

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
  return prisma.$transaction(async (tx) => {
    const record = await tx.financeRecord.create({
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

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'finance-record',
      aggregateId: record.id,
      operation: 'upsert',
      payload: toProjectionPayload(toFinanceProjectionPayload(record)),
    });

    return record;
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
  return prisma.$transaction(async (tx) => {
    const record = await tx.financeRecord.update({
      where: { id },
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
    });

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'finance-record',
      aggregateId: record.id,
      operation: 'upsert',
      payload: toProjectionPayload(toFinanceProjectionPayload(record)),
    });

    return record;
  });
}

export async function softDeleteFinanceRecord(id: string) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.financeRecord.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        version: {
          increment: 1,
        },
      },
    });

    await enqueueProjectionOutboxEvent(tx, {
      topic: KNOWLEDGE_PROJECTION_TOPIC,
      aggregateType: 'finance-record',
      aggregateId: record.id,
      operation: 'delete',
      payload: toProjectionPayload({
        id: record.id,
      }),
    });

    return record;
  });
}
