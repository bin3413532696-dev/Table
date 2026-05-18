import { prisma } from '../../../db/client';
import { getCurrentUserId } from '../../../shared/user-context';
import type { AgentState } from './state';

/**
 * 状态持久化 - 与现有 AgentRunStateSnapshot 表兼容
 */

/**
 * 保存状态快照
 */
export async function saveStateSnapshot(state: AgentState): Promise<void> {
  const userId = getCurrentUserId();

  await prisma.agentRunStateSnapshot.create({
    data: {
      userId,
      runId: state.runId,
      snapshotJson: JSON.stringify(state),
    },
  });
}

/**
 * 获取最新状态快照
 */
export async function getLatestStateSnapshot(runId: string): Promise<AgentState | null> {
  const userId = getCurrentUserId();

  const snapshot = await prisma.agentRunStateSnapshot.findFirst({
    where: {
      userId,
      runId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!snapshot) return null;

  try {
    return JSON.parse(snapshot.snapshotJson as string) as AgentState;
  } catch {
    return null;
  }
}

/**
 * 删除旧快照（保留最近 10 个）
 */
export async function cleanupOldSnapshots(runId: string): Promise<void> {
  const userId = getCurrentUserId();

  const snapshots = await prisma.agentRunStateSnapshot.findMany({
    where: {
      userId,
      runId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 10,
  });

  const keepIds = snapshots.map((s: { id: string }) => s.id);

  await prisma.agentRunStateSnapshot.deleteMany({
    where: {
      userId,
      runId,
      NOT: {
        id: { in: keepIds },
      },
    },
  });
}