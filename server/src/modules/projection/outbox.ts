import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';

export const KNOWLEDGE_PROJECTION_TOPIC = 'knowledge.projection';
export const PROJECTION_STATUS_PENDING = 'pending';
export const PROJECTION_STATUS_PROCESSING = 'processing';
export const PROJECTION_STATUS_PROCESSED = 'processed';
export const PROJECTION_STATUS_FAILED = 'failed';

export type ProjectionDatabaseClient = Prisma.TransactionClient | PrismaClient;

export type ProjectionOutboxEventInput = {
  userId?: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  operation: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
};

export function toProjectionPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function enqueueProjectionOutboxEvent(
  db: ProjectionDatabaseClient,
  input: ProjectionOutboxEventInput
) {
  return db.projectionOutboxEvent.create({
    data: {
      userId: input.userId ?? getCurrentUserId(),
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      operation: input.operation,
      payloadJson: input.payload,
      availableAt: input.availableAt ?? new Date(),
    },
  });
}

export async function enqueueProjectionOutboxEvents(
  db: ProjectionDatabaseClient,
  inputs: ProjectionOutboxEventInput[]
) {
  if (inputs.length === 0) {
    return;
  }

  await db.projectionOutboxEvent.createMany({
    data: inputs.map((input) => ({
      userId: input.userId ?? getCurrentUserId(),
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      operation: input.operation,
      payloadJson: input.payload,
      availableAt: input.availableAt ?? new Date(),
    })),
  });
}

export async function listPendingProjectionOutboxEvents(limit: number) {
  return prisma.projectionOutboxEvent.findMany({
    where: {
      status: PROJECTION_STATUS_PENDING,
      availableAt: {
        lte: new Date(),
      },
    },
    orderBy: [
      { availableAt: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });
}

export async function claimProjectionOutboxEvent(id: string) {
  const result = await prisma.projectionOutboxEvent.updateMany({
    where: {
      id,
      status: PROJECTION_STATUS_PENDING,
    },
    data: {
      status: PROJECTION_STATUS_PROCESSING,
      attempts: {
        increment: 1,
      },
      lastError: null,
    },
  });

  return result.count > 0;
}

export async function markProjectionOutboxEventProcessed(id: string) {
  await prisma.projectionOutboxEvent.update({
    where: { id },
    data: {
      status: PROJECTION_STATUS_PROCESSED,
      processedAt: new Date(),
      lastError: null,
    },
  });
}

export async function rescheduleProjectionOutboxEvent(
  id: string,
  attempts: number,
  errorMessage: string
) {
  const delayMs = Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 30000);

  await prisma.projectionOutboxEvent.update({
    where: { id },
    data: {
      status: attempts >= 5 ? PROJECTION_STATUS_FAILED : PROJECTION_STATUS_PENDING,
      availableAt: new Date(Date.now() + delayMs),
      processedAt: null,
      lastError: errorMessage,
    },
  });
}
