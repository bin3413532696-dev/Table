import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type {
  AppendAgentMessageInput,
  CreateAgentRunInput,
  CreateToolExecutionInput,
  ListAgentRunsQuery,
  UpdateAgentRunInput,
} from './schema';

function toJsonValue(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function listAgentRuns(input: ListAgentRunsQuery) {
  const whereClause = {
    userId: getCurrentUserId(),
    ...(input.status ? { status: input.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.agentRun.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.agentRun.count({
      where: whereClause,
    }),
  ]);

  return { items, total };
}

export async function findAgentRunById(id: string) {
  return prisma.agentRun.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
    },
  });
}

export async function findAgentRunDetailById(id: string) {
  return prisma.agentRun.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
    },
    include: {
      messages: {
        orderBy: {
          sequence: 'asc',
        },
      },
      toolExecutions: {
        orderBy: {
          sequence: 'asc',
        },
      },
      stateSnapshots: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      },
    },
  });
}

export async function findLatestAgentRunSnapshot(runId: string) {
  return prisma.agentRunStateSnapshot.findFirst({
    where: {
      runId,
      userId: getCurrentUserId(),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

export async function findToolExecutionById(runId: string, toolExecutionId: string) {
  return prisma.toolExecution.findFirst({
    where: {
      id: toolExecutionId,
      runId,
      userId: getCurrentUserId(),
    },
  });
}

async function getNextMessageSequence(runId: string, tx: Prisma.TransactionClient) {
  const aggregate = await tx.agentMessage.aggregate({
    where: {
      runId,
      userId: getCurrentUserId(),
    },
    _max: {
      sequence: true,
    },
  });

  return (aggregate._max.sequence ?? 0) + 1;
}

async function getNextToolExecutionSequence(runId: string, tx: Prisma.TransactionClient) {
  const aggregate = await tx.toolExecution.aggregate({
    where: {
      runId,
      userId: getCurrentUserId(),
    },
    _max: {
      sequence: true,
    },
  });

  return (aggregate._max.sequence ?? 0) + 1;
}

export async function createAgentRun(input: CreateAgentRunInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        userId: getCurrentUserId(),
        sessionId: input.sessionId,
        status: 'pending',
        inputText: input.inputText,
        model: input.model,
      },
    });

    const messages = [
      {
        role: 'user' as const,
        content: input.inputText,
        metadata: { source: 'run_input' },
      },
      ...input.initialMessages,
    ];

    if (messages.length > 0) {
      await tx.agentMessage.createMany({
        data: messages.map((message, index) => ({
          userId: getCurrentUserId(),
          runId: run.id,
          role: message.role,
          content: message.content,
          sequence: index + 1,
          metadataJson: toJsonValue(message.metadata),
        })),
      });
    }

    await tx.agentRunStateSnapshot.create({
      data: {
        userId: getCurrentUserId(),
        runId: run.id,
        snapshotJson: {
          phase: 'created',
          messageCount: messages.length,
        } as Prisma.InputJsonValue,
      },
    });

    return run;
  });
}

export async function appendAgentMessage(runId: string, input: AppendAgentMessageInput) {
  return prisma.$transaction(async (tx) => {
    const sequence = await getNextMessageSequence(runId, tx);

    return tx.agentMessage.create({
      data: {
        userId: getCurrentUserId(),
        runId,
        role: input.role,
        content: input.content,
        sequence,
        metadataJson: toJsonValue(input.metadata),
      },
    });
  });
}

export async function updateAgentRun(id: string, input: UpdateAgentRunInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.update({
      where: {
        id,
      },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.requiresConfirmation !== undefined
          ? { requiresConfirmation: input.requiresConfirmation }
          : {}),
        ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
        version: {
          increment: 1,
        },
      },
    });

    if (input.snapshot) {
      await tx.agentRunStateSnapshot.create({
        data: {
          userId: getCurrentUserId(),
          runId: id,
          snapshotJson: toJsonValue(input.snapshot),
        },
      });
    }

    return run;
  });
}

export async function createToolExecution(runId: string, input: CreateToolExecutionInput) {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const sequence = await getNextToolExecutionSequence(runId, tx);

        const execution = await tx.toolExecution.create({
          data: {
            userId: getCurrentUserId(),
            runId,
            toolName: input.toolName,
            argumentsJson: toJsonValue(input.arguments),
            status: input.status,
            requiresConfirmation: input.requiresConfirmation,
            confirmationRequestedAt: input.confirmationRequestedAt,
            confirmedAt: input.confirmedAt,
            resultJson: input.result ? toJsonValue(input.result) : undefined,
            errorMessage: input.errorMessage ?? undefined,
            sequence,
          },
        });

        if (input.requiresConfirmation || input.status === 'waiting_confirmation') {
          await tx.agentRun.update({
            where: {
              id: runId,
            },
            data: {
              status: 'waiting_confirmation',
              requiresConfirmation: true,
              version: {
                increment: 1,
              },
            },
          });
        }

        return execution;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'U2005' && attempt < maxRetries - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to create tool execution after max retries');
}

export async function updateToolExecution(
  runId: string,
  toolExecutionId: string,
  input: {
    status?: string;
    requiresConfirmation?: boolean;
    confirmationRequestedAt?: Date | null;
    confirmedAt?: Date | null;
    result?: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const execution = await tx.toolExecution.update({
      where: {
        id: toolExecutionId,
      },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.requiresConfirmation !== undefined
          ? { requiresConfirmation: input.requiresConfirmation }
          : {}),
        ...(input.confirmationRequestedAt !== undefined
          ? { confirmationRequestedAt: input.confirmationRequestedAt }
          : {}),
        ...(input.confirmedAt !== undefined ? { confirmedAt: input.confirmedAt } : {}),
        ...(input.result !== undefined ? { resultJson: toJsonValue(input.result) } : {}),
        ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
      },
    });

    if (input.status && input.status !== 'waiting_confirmation') {
      await tx.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          requiresConfirmation: false,
          version: {
            increment: 1,
          },
        },
      });
    }

    return execution;
  });
}

export async function deleteAgentRunById(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.agentRun.findFirst({
      where: {
        id,
        userId: getCurrentUserId(),
      },
    });

    if (!existing) {
      return null;
    }

    // 级联删除关联数据（Prisma schema 中已有 onDelete: Cascade，但显式删除更安全）
    await tx.agentMessage.deleteMany({
      where: {
        runId: id,
        userId: getCurrentUserId(),
      },
    });

    await tx.toolExecution.deleteMany({
      where: {
        runId: id,
        userId: getCurrentUserId(),
      },
    });

    await tx.agentRunStateSnapshot.deleteMany({
      where: {
        runId: id,
        userId: getCurrentUserId(),
      },
    });

    return tx.agentRun.delete({
      where: {
        id,
      },
    });
  });
}
