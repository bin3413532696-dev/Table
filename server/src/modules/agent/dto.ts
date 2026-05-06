import type {
  AgentMessage,
  AgentRun,
  AgentRunStateSnapshot,
  ToolExecution,
} from '@prisma/client';

function toTimestamp(value: Date | null): number | undefined {
  if (!value) {
    return undefined;
  }

  return value.getTime();
}

export function toAgentRunDto(run: AgentRun) {
  return {
    id: run.id,
    sessionId: run.sessionId ?? undefined,
    status: run.status,
    inputText: run.inputText,
    model: run.model,
    requiresConfirmation: run.requiresConfirmation,
    errorMessage: run.errorMessage ?? undefined,
    startedAt: run.startedAt.getTime(),
    finishedAt: toTimestamp(run.finishedAt),
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
    version: run.version,
  };
}

export function toAgentMessageDto(message: AgentMessage) {
  return {
    id: message.id,
    runId: message.runId,
    role: message.role,
    content: message.content,
    sequence: message.sequence,
    metadata: message.metadataJson,
    createdAt: message.createdAt.getTime(),
  };
}

export function toToolExecutionDto(execution: ToolExecution) {
  return {
    id: execution.id,
    runId: execution.runId,
    toolName: execution.toolName,
    arguments: execution.argumentsJson,
    status: execution.status,
    requiresConfirmation: execution.requiresConfirmation,
    confirmationRequestedAt: toTimestamp(execution.confirmationRequestedAt),
    confirmedAt: toTimestamp(execution.confirmedAt),
    result: execution.resultJson ?? undefined,
    errorMessage: execution.errorMessage ?? undefined,
    sequence: execution.sequence,
    createdAt: execution.createdAt.getTime(),
    updatedAt: execution.updatedAt.getTime(),
  };
}

export function toAgentRunSnapshotDto(snapshot: AgentRunStateSnapshot) {
  return {
    id: snapshot.id,
    runId: snapshot.runId,
    snapshot: snapshot.snapshotJson,
    createdAt: snapshot.createdAt.getTime(),
  };
}
