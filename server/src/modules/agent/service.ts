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
  deleteAgentRunById,
} from './repository';
import {
  executeAgentRunWithStream,
  continueAgentRunWithStream,
  type StreamEvent,
  type StreamEventEmitter,
} from './langgraph/streaming';
import { saveStateSnapshot, cleanupOldSnapshots } from './langgraph/persistence';
import type { AgentState, ToolCall } from './langgraph/state';
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
      type: 'text_chunk';
      runId: string;
      text: string;
    }
  | {
      type: 'tool_call';
      runId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      runId: string;
      toolName: string;
      result: unknown;
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
  const { items, total } = await listAgentRuns(input);
  return { items: items.map(toAgentRunDto), total };
}

async function emitAgentRunEvent(
  emit: ((event: AgentRunStreamEvent) => Promise<void> | void) | undefined,
  event: AgentRunStreamEvent
) {
  if (!emit) return;
  await emit(event);
}

async function executeAgentRunRecordLifecycle(
  input: CreateAgentRunInput,
  emit?: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const run = await createAgentRun(input);
  const createdRun = await getAgentRunDetail(run.id);
  if (!createdRun) throw new Error('Agent run created but detail not found');

  await emitAgentRunEvent(emit, { type: 'run_created', run: createdRun });

  try {
    const provider = await getRequiredActiveProviderForCurrentUser();
    const userId = run.userId;

    await updateAgentRun(run.id, { status: 'running', snapshot: { phase: 'running' } });
    await emitAgentRunEvent(emit, { type: 'status', runId: run.id, status: 'running' });

    // LangGraph 执行
    const langGraphEmit: StreamEventEmitter = async (event: StreamEvent) => {
      if (event.type === 'status') {
        await emitAgentRunEvent(emit, { type: 'status', runId: run.id, status: event.status });
      } else if (event.type === 'text_chunk') {
        await emitAgentRunEvent(emit, { type: 'text_chunk', runId: run.id, text: event.text });
      } else if (event.type === 'tool_call') {
        await emitAgentRunEvent(emit, { type: 'tool_call', runId: run.id, toolName: event.toolName, arguments: event.arguments });
      } else if (event.type === 'tool_result') {
        await emitAgentRunEvent(emit, { type: 'tool_result', runId: run.id, toolName: event.toolName, result: event.result });
      }
    };

    const result = await executeAgentRunWithStream({
      inputText: input.inputText,
      initialMessages: input.initialMessages
        .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      provider: {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        headers: provider.headers,
      },
      model: input.model === 'default' ? (provider.model || 'default') : input.model,
      runId: run.id,
      userId,
    }, langGraphEmit);

    await saveStateSnapshot(result);

    if (result.status === 'waiting_confirmation') {
      for (const tc of result.executedToolCalls) {
        await createToolExecution(run.id, {
          toolName: tc.name,
          arguments: tc.arguments,
          status: 'completed',
          requiresConfirmation: false,
          result: { success: tc.success, data: tc.result },
        });
      }

      const pendingTool = result.pendingToolExecution!;
      const pendingExecution = await createToolExecution(run.id, {
        toolName: pendingTool.toolName,
        arguments: pendingTool.arguments,
        status: 'waiting_confirmation',
        requiresConfirmation: true,
        confirmationRequestedAt: new Date(),
        result: { confirmationMessage: pendingTool.confirmationMessage },
      });

      await appendAgentMessage(run.id, {
        role: 'assistant',
        content: result.messages[result.messages.length - 1]?.content || pendingTool.confirmationMessage,
        metadata: { pendingToolExecutionId: pendingExecution.id, pendingToolName: pendingTool.toolName },
      });

      await updateAgentRun(run.id, {
        status: 'waiting_confirmation',
        requiresConfirmation: true,
        snapshot: { ...result, pendingToolExecutionId: pendingExecution.id },
      });

      const waitingRun = await getAgentRunDetail(run.id);
      if (!waitingRun) throw new Error('Agent run waiting confirmation but detail not found');

      await emitAgentRunEvent(emit, { type: 'status', runId: run.id, status: 'waiting_confirmation' });
      await emitAgentRunEvent(emit, { type: 'run_waiting_confirmation', run: waitingRun });
      return waitingRun;
    }

    // 完成
    for (const tc of result.executedToolCalls) {
      await createToolExecution(run.id, {
        toolName: tc.name,
        arguments: tc.arguments,
        status: 'completed',
        requiresConfirmation: false,
        result: { success: tc.success, data: tc.result },
      });
    }

    await appendAgentMessage(run.id, {
      role: 'assistant',
      content: result.finalText,
      metadata: result.executedToolCalls.length > 0
        ? { toolCalls: result.executedToolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments })) }
        : undefined,
    });

    await updateAgentRun(run.id, {
      status: 'completed',
      finishedAt: new Date(),
      snapshot: { phase: 'completed', toolExecutionCount: result.executedToolCalls.length },
    });

    await cleanupOldSnapshots(run.id);

    const completedRun = await getAgentRunDetail(run.id);
    if (!completedRun) throw new Error('Agent run completed but detail not found');

    await emitAgentRunEvent(emit, { type: 'status', runId: run.id, status: 'completed' });
    await emitAgentRunEvent(emit, { type: 'run_completed', run: completedRun });
    return completedRun;
  } catch (error) {
    await appendAgentMessage(run.id, {
      role: 'assistant',
      content: '处理请求时发生错误。',
      metadata: { error: error instanceof Error ? error.message : '未知错误' },
    });

    await updateAgentRun(run.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : '未知错误',
      finishedAt: new Date(),
      snapshot: { phase: 'failed', error: error instanceof Error ? error.message : '未知错误' },
    });

    const failedRun = await getAgentRunDetail(run.id);
    if (!failedRun) throw new Error('Agent run failed but detail not found');

    await emitAgentRunEvent(emit, { type: 'status', runId: run.id, status: 'failed' });
    await emitAgentRunEvent(emit, { type: 'run_failed', run: failedRun });
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
  if (!existingRun) return null;

  const execution = await findToolExecutionById(runId, toolExecutionId);
  if (!execution) return null;

  if (execution.status !== 'waiting_confirmation') {
    throw new Error('当前工具执行不处于待确认状态');
  }

  const latestSnapshot = await findLatestAgentRunSnapshot(runId);
  if (!latestSnapshot?.snapshotJson) {
    throw new Error('未找到可恢复的待确认执行快照');
  }

  const langGraphState = latestSnapshot.snapshotJson as AgentState;
  if (langGraphState.status !== 'waiting_confirmation') {
    throw new Error('快照状态不匹配');
  }

  const confirmedToolCall: ToolCall = {
    id: execution.id,
    name: execution.toolName,
    arguments: execution.argumentsJson as Record<string, unknown>,
  };

  const result = await continueAgentRunWithStream(
    langGraphState,
    confirmedToolCall,
    async (event: StreamEvent) => {
      console.log('[LangGraph Confirm]', event.type);
    }
  );

  await saveStateSnapshot(result);
  await cleanupOldSnapshots(runId);

  await updateToolExecution(runId, toolExecutionId, {
    status: 'completed',
    requiresConfirmation: false,
    confirmedAt: new Date(),
    result: {
      success: result.executedToolCalls[result.executedToolCalls.length - 1]?.success ?? true,
      data: result.executedToolCalls[result.executedToolCalls.length - 1]?.result,
    },
    errorMessage: null,
  });

  if (result.status === 'waiting_confirmation') {
    const nextPendingTool = result.pendingToolExecution!;
    const nextPendingExecution = await createToolExecution(runId, {
      toolName: nextPendingTool.toolName,
      arguments: nextPendingTool.arguments,
      status: 'waiting_confirmation',
      requiresConfirmation: true,
      confirmationRequestedAt: new Date(),
      result: { confirmationMessage: nextPendingTool.confirmationMessage },
    });

    await appendAgentMessage(runId, {
      role: 'assistant',
      content: result.messages[result.messages.length - 1]?.content || nextPendingTool.confirmationMessage,
      metadata: {
        confirmedToolExecutionId: toolExecutionId,
        confirmedToolName: execution.toolName,
        pendingToolExecutionId: nextPendingExecution.id,
        pendingToolName: nextPendingTool.toolName,
      },
    });

    await updateAgentRun(runId, {
      status: 'waiting_confirmation',
      requiresConfirmation: true,
      snapshot: { ...result, pendingToolExecutionId: nextPendingExecution.id },
    });

    return getAgentRunDetail(runId);
  }

  // 完成
  await appendAgentMessage(runId, {
    role: 'assistant',
    content: result.finalText,
    metadata: { confirmedToolExecutionId: toolExecutionId, confirmedToolName: execution.toolName },
  });

  await updateAgentRun(runId, {
    status: 'completed',
    requiresConfirmation: false,
    finishedAt: new Date(),
    snapshot: { phase: 'completed_after_confirmation', confirmedToolExecutionId: toolExecutionId },
  });

  return getAgentRunDetail(runId);
}

export async function rejectAgentRunTool(runId: string, toolExecutionId: string) {
  const existingRun = await findAgentRunById(runId);
  if (!existingRun) return null;

  const execution = await findToolExecutionById(runId, toolExecutionId);
  if (!execution) return null;

  if (execution.status !== 'waiting_confirmation') {
    throw new Error('当前工具执行不处于待确认状态');
  }

  await updateToolExecution(runId, toolExecutionId, {
    status: 'cancelled',
    requiresConfirmation: false,
    result: { cancelled: true },
    errorMessage: '用户取消执行',
  });

  await appendAgentMessage(runId, {
    role: 'assistant',
    content: `已取消执行 ${execution.toolName}。`,
    metadata: { cancelledToolExecutionId: toolExecutionId, cancelledToolName: execution.toolName },
  });

  await updateAgentRun(runId, {
    status: 'cancelled',
    requiresConfirmation: false,
    finishedAt: new Date(),
    snapshot: { phase: 'cancelled', cancelledToolExecutionId: toolExecutionId },
  });

  return getAgentRunDetail(runId);
}

export async function getAgentRunDetail(id: string) {
  const run = await findAgentRunDetailById(id);
  if (!run) return null;

  return {
    ...toAgentRunDto(run),
    messages: run.messages.map(toAgentMessageDto),
    toolExecutions: run.toolExecutions.map(toToolExecutionDto),
    snapshots: run.stateSnapshots.map(toAgentRunSnapshotDto),
  };
}

export async function appendAgentRunMessage(id: string, input: AppendAgentMessageInput) {
  const existing = await findAgentRunById(id);
  if (!existing) return null;

  const message = await appendAgentMessage(id, input);
  return toAgentMessageDto(message);
}

export async function updateAgentRunRecord(id: string, input: UpdateAgentRunInput) {
  const existing = await findAgentRunById(id);
  if (!existing) return null;

  const run = await updateAgentRun(id, input);
  return toAgentRunDto(run);
}

export async function createAgentToolExecution(id: string, input: CreateToolExecutionInput) {
  const existing = await findAgentRunById(id);
  if (!existing) return null;

  const execution = await createToolExecution(id, input);
  return toToolExecutionDto(execution);
}

export async function deleteAgentRunRecord(id: string) {
  const deleted = await deleteAgentRunById(id);
  if (!deleted) return null;
  return { id: deleted.id, deleted: true };
}