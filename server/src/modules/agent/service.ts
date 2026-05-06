import {
  appendAgentMessage,
  createAgentRun,
  createToolExecution,
  findLatestAgentRunSnapshot,
  findAgentRunById,
  findAgentRunDetailById,
  findToolExecutionById,
  listAgentRuns,
  updateAgentRun,
  updateToolExecution,
} from './repository';
import {
  confirmAgentRunToolExecution,
  executeAgentRun,
  type PendingConfirmationSnapshot,
} from './executor';
import { getActiveProviderForCurrentUser, getRequiredActiveProviderForCurrentUser } from '../providers/service';
import {
  toAgentMessageDto,
  toAgentRunDto,
  toAgentRunSnapshotDto,
  toToolExecutionDto,
} from './dto';
import type {
  AppendAgentMessageInput,
  CreateAgentRunInput,
  CreateToolExecutionInput,
  ConfirmToolExecutionInput,
  ListAgentRunsQuery,
  UpdateAgentRunInput,
} from './schema';

export type AgentRunStreamEvent =
  | {
      type: 'run_created';
      run: NonNullable<Awaited<ReturnType<typeof getAgentRunDetail>>>;
    }
  | {
      type: 'status';
      runId: string;
      status: 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';
    }
  | {
      type: 'run_completed' | 'run_waiting_confirmation' | 'run_failed' | 'run_cancelled';
      run: NonNullable<Awaited<ReturnType<typeof getAgentRunDetail>>>;
    };

export async function getAgentRuntimeStatus() {
  const provider = await getActiveProviderForCurrentUser();

  return {
    connected: Boolean(provider?.baseUrl?.trim()),
    selectedModel: provider?.model || 'llama3.2',
    availableModels: provider?.model ? [provider.model] : [],
    provider: provider
      ? {
          id: provider.id,
          name: provider.name,
          apiFormat: provider.apiFormat,
          baseUrl: provider.baseUrl,
          hasApiKey: provider.hasApiKey,
        }
      : null,
  };
}

export async function getAgentRunList(input: ListAgentRunsQuery) {
  const runs = await listAgentRuns(input);
  return runs.map(toAgentRunDto);
}

async function emitAgentRunEvent(
  emit: ((event: AgentRunStreamEvent) => Promise<void> | void) | undefined,
  event: AgentRunStreamEvent
) {
  if (!emit) {
    return;
  }

  await emit(event);
}

async function executeAgentRunRecordLifecycle(
  input: CreateAgentRunInput,
  emit?: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const run = await createAgentRun(input);
  const createdRun = await getAgentRunDetail(run.id);
  if (!createdRun) {
    throw new Error('Agent run created but detail not found');
  }

  await emitAgentRunEvent(emit, {
    type: 'run_created',
    run: createdRun,
  });

  try {
    const provider = await getRequiredActiveProviderForCurrentUser();

    await updateAgentRun(run.id, {
      status: 'running',
      snapshot: {
        phase: 'running',
      },
    });
    await emitAgentRunEvent(emit, {
      type: 'status',
      runId: run.id,
      status: 'running',
    });

    const execution = await executeAgentRun({
      ...input,
      provider,
    });

    if (execution.status === 'waiting_confirmation') {
      for (const toolCall of execution.executedToolCalls) {
        await createToolExecution(run.id, {
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          status: 'completed',
          requiresConfirmation: false,
          result: {
            success: true,
            data: toolCall.result,
          },
        });
      }

      const pendingExecution = await createToolExecution(run.id, {
        toolName: execution.pendingToolCall.name,
        arguments: execution.pendingToolCall.arguments,
        status: 'waiting_confirmation',
        requiresConfirmation: true,
        confirmationRequestedAt: new Date(),
        result: {
          confirmationMessage: execution.confirmationMessage,
        },
      });

      await appendAgentMessage(run.id, {
        role: 'assistant',
        content: execution.interimText || execution.confirmationMessage,
        metadata: {
          pendingToolExecutionId: pendingExecution.id,
          pendingToolName: execution.pendingToolCall.name,
        },
      });

      await updateAgentRun(run.id, {
        status: 'waiting_confirmation',
        requiresConfirmation: true,
        snapshot: {
          ...execution.snapshot,
          pendingToolExecutionId: pendingExecution.id,
        },
      });
      const waitingRun = await getAgentRunDetail(run.id);
      if (!waitingRun) {
        throw new Error('Agent run waiting confirmation but detail not found');
      }

      await emitAgentRunEvent(emit, {
        type: 'status',
        runId: run.id,
        status: 'waiting_confirmation',
      });
      await emitAgentRunEvent(emit, {
        type: 'run_waiting_confirmation',
        run: waitingRun,
      });
      return waitingRun;
    }

    for (const toolCall of execution.toolCalls) {
      await createToolExecution(run.id, {
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        status: 'completed',
        requiresConfirmation: false,
        result: {
          success: true,
          data: toolCall.result,
        },
      });
    }

    await appendAgentMessage(run.id, {
      role: 'assistant',
      content: execution.finalText,
      metadata: execution.toolCalls.length > 0
        ? {
            toolCalls: execution.toolCalls.map((toolCall) => ({
              name: toolCall.name,
              arguments: toolCall.arguments,
            })),
          }
        : undefined,
    });

    await updateAgentRun(run.id, {
      status: 'completed',
      finishedAt: new Date(),
      snapshot: {
        phase: 'completed',
        toolExecutionCount: execution.toolCalls.length,
      },
    });
    const completedRun = await getAgentRunDetail(run.id);
    if (!completedRun) {
      throw new Error('Agent run completed but detail not found');
    }

    await emitAgentRunEvent(emit, {
      type: 'status',
      runId: run.id,
      status: 'completed',
    });
    await emitAgentRunEvent(emit, {
      type: 'run_completed',
      run: completedRun,
    });
    return completedRun;
  } catch (error) {
    await appendAgentMessage(run.id, {
      role: 'assistant',
      content: '处理请求时发生错误。',
      metadata: {
        error: error instanceof Error ? error.message : '未知错误',
      },
    });

    await updateAgentRun(run.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : '未知错误',
      finishedAt: new Date(),
      snapshot: {
        phase: 'failed',
        error: error instanceof Error ? error.message : '未知错误',
      },
    });

    const failedRun = await getAgentRunDetail(run.id);
    if (!failedRun) {
      throw new Error('Agent run failed but detail not found');
    }

    await emitAgentRunEvent(emit, {
      type: 'status',
      runId: run.id,
      status: 'failed',
    });
    await emitAgentRunEvent(emit, {
      type: 'run_failed',
      run: failedRun,
    });
    return failedRun;
  }
}

export async function createAgentRunRecord(input: CreateAgentRunInput) {
  return executeAgentRunRecordLifecycle(input);
}

export async function streamAgentRunRecord(
  input: CreateAgentRunInput,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return executeAgentRunRecordLifecycle(input, emit);
}

export async function confirmAgentRunTool(
  runId: string,
  toolExecutionId: string,
  input: ConfirmToolExecutionInput
) {
  const existingRun = await findAgentRunById(runId);
  if (!existingRun) {
    return null;
  }

  const execution = await findToolExecutionById(runId, toolExecutionId);
  if (!execution) {
    return null;
  }

  if (execution.status !== 'waiting_confirmation') {
    throw new Error('当前工具执行不处于待确认状态');
  }

  const latestSnapshot = await findLatestAgentRunSnapshot(runId);
  const snapshot = latestSnapshot?.snapshotJson as Partial<PendingConfirmationSnapshot> | undefined;
  if (!snapshot || snapshot.kind !== 'pending_confirmation') {
    throw new Error('未找到可恢复的待确认执行快照');
  }

  const provider = await getRequiredActiveProviderForCurrentUser();

  const confirmed = await confirmAgentRunToolExecution({
    provider,
    snapshot: snapshot as PendingConfirmationSnapshot,
    pendingToolCall: {
      name: execution.toolName,
      arguments: execution.argumentsJson as Record<string, unknown>,
    },
  });

  await updateToolExecution(runId, toolExecutionId, {
    status: 'completed',
    requiresConfirmation: false,
    confirmedAt: new Date(),
    result: {
      success: true,
      data: confirmed.confirmedToolCall.result,
    },
    errorMessage: null,
  });

  if (confirmed.status === 'waiting_confirmation') {
    const alreadyRecordedKeys = new Set(
      (snapshot.executedToolCalls || []).map(
        (toolCall) => `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`
      )
    );
    alreadyRecordedKeys.add(`${execution.toolName}:${JSON.stringify(execution.argumentsJson)}`);

    const intermediateToolCalls = confirmed.executedToolCalls.filter((toolCall) => {
      const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
      return !alreadyRecordedKeys.has(key);
    });

    for (const toolCall of intermediateToolCalls) {
      await createToolExecution(runId, {
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        status: 'completed',
        requiresConfirmation: false,
        result: {
          success: true,
          data: toolCall.result,
        },
      });
    }

    const nextPendingExecution = await createToolExecution(runId, {
      toolName: confirmed.pendingToolCall.name,
      arguments: confirmed.pendingToolCall.arguments,
      status: 'waiting_confirmation',
      requiresConfirmation: true,
      confirmationRequestedAt: new Date(),
      result: {
        confirmationMessage: confirmed.confirmationMessage,
      },
    });

    await appendAgentMessage(runId, {
      role: 'assistant',
      content: confirmed.interimText || confirmed.confirmationMessage,
      metadata: {
        confirmedToolExecutionId: toolExecutionId,
        confirmedToolName: execution.toolName,
        pendingToolExecutionId: nextPendingExecution.id,
        pendingToolName: confirmed.pendingToolCall.name,
      },
    });

    await updateAgentRun(runId, {
      status: 'waiting_confirmation',
      requiresConfirmation: true,
      snapshot: {
        ...confirmed.snapshot,
        pendingToolExecutionId: nextPendingExecution.id,
      },
    });

    return getAgentRunDetail(runId);
  }

  const alreadyRecordedKeys = new Set(
    (snapshot.executedToolCalls || []).map(
      (toolCall) => `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`
    )
  );
  alreadyRecordedKeys.add(`${execution.toolName}:${JSON.stringify(execution.argumentsJson)}`);

  const trailingToolCalls = confirmed.toolCalls.filter((toolCall) => {
    const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
    return !alreadyRecordedKeys.has(key);
  });

  for (const toolCall of trailingToolCalls) {
    await createToolExecution(runId, {
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      status: 'completed',
      requiresConfirmation: false,
      result: {
        success: true,
        data: toolCall.result,
      },
    });
  }

  await appendAgentMessage(runId, {
    role: 'assistant',
    content: confirmed.finalText,
    metadata: {
      confirmedToolExecutionId: toolExecutionId,
      confirmedToolName: execution.toolName,
    },
  });

  await updateAgentRun(runId, {
    status: 'completed',
    requiresConfirmation: false,
    finishedAt: new Date(),
    snapshot: {
      phase: 'completed_after_confirmation',
      confirmedToolExecutionId: toolExecutionId,
    },
  });

  return getAgentRunDetail(runId);
}

export async function rejectAgentRunTool(runId: string, toolExecutionId: string) {
  const existingRun = await findAgentRunById(runId);
  if (!existingRun) {
    return null;
  }

  const execution = await findToolExecutionById(runId, toolExecutionId);
  if (!execution) {
    return null;
  }

  if (execution.status !== 'waiting_confirmation') {
    throw new Error('当前工具执行不处于待确认状态');
  }

  await updateToolExecution(runId, toolExecutionId, {
    status: 'cancelled',
    requiresConfirmation: false,
    result: {
      cancelled: true,
    },
    errorMessage: '用户取消执行',
  });

  await appendAgentMessage(runId, {
    role: 'assistant',
    content: `已取消执行 ${execution.toolName}。`,
    metadata: {
      cancelledToolExecutionId: toolExecutionId,
      cancelledToolName: execution.toolName,
    },
  });

  await updateAgentRun(runId, {
    status: 'cancelled',
    requiresConfirmation: false,
    finishedAt: new Date(),
    snapshot: {
      phase: 'cancelled',
      cancelledToolExecutionId: toolExecutionId,
    },
  });

  return getAgentRunDetail(runId);
}

export async function getAgentRunDetail(id: string) {
  const run = await findAgentRunDetailById(id);
  if (!run) {
    return null;
  }

  return {
    ...toAgentRunDto(run),
    messages: run.messages.map(toAgentMessageDto),
    toolExecutions: run.toolExecutions.map(toToolExecutionDto),
    snapshots: run.stateSnapshots.map(toAgentRunSnapshotDto),
  };
}

export async function appendAgentRunMessage(id: string, input: AppendAgentMessageInput) {
  const existing = await findAgentRunById(id);
  if (!existing) {
    return null;
  }

  const message = await appendAgentMessage(id, input);
  return toAgentMessageDto(message);
}

export async function updateAgentRunRecord(id: string, input: UpdateAgentRunInput) {
  const existing = await findAgentRunById(id);
  if (!existing) {
    return null;
  }

  const run = await updateAgentRun(id, input);
  return toAgentRunDto(run);
}

export async function createAgentToolExecution(id: string, input: CreateToolExecutionInput) {
  const existing = await findAgentRunById(id);
  if (!existing) {
    return null;
  }

  const execution = await createToolExecution(id, input);
  return toToolExecutionDto(execution);
}
