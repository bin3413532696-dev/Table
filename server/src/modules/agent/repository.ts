import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateAgentRunInput, ListAgentRunsQuery, UpdateAgentRunInput } from './schema';

/**
 * 极简 Repository - 只操作 AgentRun 表
 * 所有对话历史和状态都由 LangGraph Checkpoint 存储
 */
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

export async function createAgentRun(input: CreateAgentRunInput) {
  return prisma.agentRun.create({
    data: {
      userId: getCurrentUserId(),
      sessionId: input.sessionId,
      status: 'pending',
      inputText: input.inputText,
      model: input.model,
    },
  });
}

export async function updateAgentRun(id: string, input: UpdateAgentRunInput) {
  return prisma.agentRun.update({
    where: {
      id,
      userId: getCurrentUserId(),
    },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      version: {
        increment: 1,
      },
    },
  });
}

export async function deleteAgentRunById(id: string) {
  const existing = await prisma.agentRun.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
    },
  });

  if (!existing) {
    return null;
  }

  return prisma.agentRun.delete({
    where: {
      id,
    },
  });
}
