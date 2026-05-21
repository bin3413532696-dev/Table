import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateAgentRunInput, ListAgentRunsQuery, UpdateAgentRunInput, CreateAgentSessionInput, ListAgentSessionsQuery, UpdateAgentPersonaInput } from './schema';

/**
 * AgentSession Repository
 */
export async function listAgentSessions(input: ListAgentSessionsQuery) {
  const whereClause = {
    userId: getCurrentUserId(),
  };

  const [items, total] = await Promise.all([
    prisma.agentSession.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
      skip: input.offset,
      include: {
        runs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    prisma.agentSession.count({ where: whereClause }),
  ]);

  return { items, total };
}

export async function findAgentSessionById(id: string) {
  return prisma.agentSession.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
    },
    include: {
      runs: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function createAgentSession(input: CreateAgentSessionInput) {
  return prisma.agentSession.create({
    data: {
      userId: getCurrentUserId(),
      title: input.title,
    },
  });
}

export async function updateAgentSession(id: string, data: { title?: string }) {
  return prisma.agentSession.update({
    where: {
      id,
      userId: getCurrentUserId(),
    },
    data,
  });
}

export async function deleteAgentSession(id: string) {
  // 获取该 session 下的所有 run，用于清理 checkpoint
  const runs = await getSessionRuns(id);

  // 真删除 session（级联删除关联的 runs）
  await prisma.agentSession.delete({
    where: {
      id,
      userId: getCurrentUserId(),
    },
  });

  return { id, runs };
}

/**
 * AgentRun Repository
 */
export async function listAgentRuns(input: ListAgentRunsQuery) {
  const whereClause = {
    userId: getCurrentUserId(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.status ? { status: input.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.agentRun.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.agentRun.count({ where: whereClause }),
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

export async function createAgentRun(input: {
  sessionId: string;
  inputText: string;
  model: string;
  initialMessages?: CreateAgentRunInput['initialMessages'];
}) {
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

export async function updateAgentRun(id: string, input: UpdateAgentRunInput, expectedVersion?: number) {
  const whereClause: Record<string, unknown> = {
    id,
    userId: getCurrentUserId(),
  };
  if (expectedVersion !== undefined) {
    whereClause.version = expectedVersion;
  }

  const data: Record<string, unknown> = {
    version: { increment: 1 },
  };
  if (input.status !== undefined) {
    data.status = input.status;
  }

  const result = await prisma.agentRun.updateMany({
    where: whereClause,
    data,
  });

  if (result.count === 0) {
    return null;
  }

  return prisma.agentRun.findUnique({ where: { id } });
}

export async function deleteAgentRunById(id: string) {
  const run = await prisma.agentRun.findFirst({
    where: {
      id,
      userId: getCurrentUserId(),
    },
  });
  if (!run) return null;

  await prisma.agentRun.delete({
    where: { id },
  });

  return run;
}

export async function getSessionRuns(sessionId: string) {
  return prisma.agentRun.findMany({
    where: {
      sessionId,
      userId: getCurrentUserId(),
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getSessionByRunId(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { sessionId: true },
  });
  if (!run) return null;
  return prisma.agentSession.findUnique({
    where: { id: run.sessionId },
    include: { runs: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Agent Persona Repository
 * 人格配置存储在 UserSetting.agentPreferencesJson
 */
export async function getAgentPersonaPrefs() {
  const userId = getCurrentUserId();
  const setting = await prisma.userSetting.findUnique({
    where: { userId },
    select: { agentPreferencesJson: true },
  });
  const prefs = setting?.agentPreferencesJson as Record<string, unknown> | null;
  return {
    systemPrompt: (prefs?.systemPrompt as string) || '',
  };
}

export async function updateAgentPersonaPrefs(input: UpdateAgentPersonaInput) {
  const userId = getCurrentUserId();
  const updated = { systemPrompt: input.systemPrompt };

  try {
    // UserSetting 应在认证时已创建，直接更新
    await prisma.userSetting.update({
      where: { userId },
      data: { agentPreferencesJson: updated },
    });

    return updated;
  } catch (error) {
    console.error('[Agent] Failed to update persona for user:', userId, error);
    throw error;
  }
}