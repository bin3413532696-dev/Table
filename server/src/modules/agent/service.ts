import {
  createAgentRun as createAgentRunRepo,
  findAgentRunById,
  listAgentRuns,
  updateAgentRun as updateAgentRunRepo,
  deleteAgentRunById,
} from './repository';
import {
  executeAgentGraph,
  continueAgentGraph,
  agentGraph,
  streamAgentGraph,
  streamContinueAgentGraph,
  type AgentGraphStreamChunk,
} from './langgraph/graph';
import { toAgentRunDto, buildAgentRunDetailDto } from './dto';
import type {
  CreateAgentRunInput,
  ListAgentRunsQuery,
  UpdateAgentRunInput,
} from './schema';
import { getActiveProviderForCurrentUser, getRequiredActiveProviderForCurrentUser } from '../providers/service';
import { getCurrentUserId } from '../../shared/user-context';
import { getCheckpointer } from './langgraph/postgres-checkpointer';
import type { AgentState, RunStatus } from './langgraph/state';

function normalizeRunStatus(status: string): RunStatus {
  switch (status) {
    case 'running':
    case 'waiting_confirmation':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return 'running';
  }
}

async function getCheckpointState(runId: string) {
  return agentGraph.getState({
    configurable: { thread_id: runId },
  });
}

async function buildRunDetail(runId: string) {
  const run = await findAgentRunById(runId);
  if (!run) {
    return null;
  }

  try {
    const state = await getCheckpointState(runId);
    if (state?.values) {
      return buildAgentRunDetailDto(run, state.values);
    }
  } catch {
    // ignore missing checkpoint data
  }

  const base = toAgentRunDto(run);
  return {
    ...base,
    status: normalizeRunStatus(base.status),
    messages: [],
    executedToolCalls: [],
    pendingToolCalls: [],
    requiresConfirmation: false,
    finalText: '',
    error: undefined,
    timeline: [],
    assistantTextChunks: [],
    iterationCount: 0,
  };
}

function buildEmptyRunState(run: ReturnType<typeof toAgentRunDto>, runId: string): AgentState {
  return {
    inputText: run.inputText,
    initialMessages: [],
    provider: {
      id: '',
      name: '',
      apiFormat: 'custom',
      baseUrl: '',
      apiKey: '',
    },
    model: run.model,
    systemPrompt: '',
    messages: [],
    executedToolCalls: [],
    pendingToolCalls: [],
    requiresConfirmation: false,
    pendingToolExecution: null,
    confirmedToolCall: null,
    finalText: '',
    runId,
    userId: '',
    iterationCount: 0,
    status: normalizeRunStatus(run.status),
    error: null,
    assistantTextChunks: [],
    timeline: [],
  };
}

function mergePartialState(base: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...base,
    ...patch,
    messages: patch.messages ?? base.messages,
    executedToolCalls: patch.executedToolCalls ?? base.executedToolCalls,
    pendingToolCalls: patch.pendingToolCalls ?? base.pendingToolCalls,
    assistantTextChunks: patch.assistantTextChunks ?? base.assistantTextChunks,
    timeline: patch.timeline ?? base.timeline,
    pendingToolExecution: patch.pendingToolExecution ?? base.pendingToolExecution,
    confirmedToolCall: patch.confirmedToolCall ?? base.confirmedToolCall,
    requiresConfirmation: patch.requiresConfirmation ?? base.requiresConfirmation,
    finalText: patch.finalText ?? base.finalText,
    status: patch.status ?? base.status,
    error: patch.error ?? base.error,
  };
}

export type AgentRunStreamEvent =
  | { type: 'metadata'; runId: string; model: string }
  | { type: 'langgraph_chunk'; mode: 'messages' | 'tasks'; chunk: unknown }
  | { type: 'run_update'; run: ReturnType<typeof buildAgentRunDetailDto> }
  | { type: 'run_completed'; run: ReturnType<typeof buildAgentRunDetailDto> };

function toStreamableRun(runRecord: NonNullable<Awaited<ReturnType<typeof findAgentRunById>>>, state?: AgentState) {
  return buildAgentRunDetailDto(runRecord, state ?? buildEmptyRunState(toAgentRunDto(runRecord), runRecord.id));
}

async function emitGraphChunk(
  runRecord: NonNullable<Awaited<ReturnType<typeof findAgentRunById>>>,
  chunk: AgentGraphStreamChunk,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void,
  lastState: AgentState
): Promise<AgentState> {
  if (chunk.mode === 'values') {
    const mergedState = mergePartialState(lastState, chunk.data as Partial<AgentState>);
    await emit({
      type: 'run_update',
      run: toStreamableRun(runRecord, mergedState),
    });
    return mergedState;
  }

  await emit({
    type: 'langgraph_chunk',
    mode: chunk.mode,
    chunk: chunk.data,
  });
  return lastState;
}

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
  return {
    items: items.map((run) => toAgentRunDto(run)),
    total,
  };
}

async function createAgentRunRecordImpl(input: CreateAgentRunInput) {
  const provider = await getRequiredActiveProviderForCurrentUser();
  const userId = getCurrentUserId();

  const run = await createAgentRunRepo({
    ...input,
    model: input.model === 'default' ? provider.model || 'default' : input.model,
  });

  const initialMessages = (input.initialMessages || []).filter(
    (m): m is { role: 'user' | 'assistant' | 'system'; content: string } =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
  );

  const result = await executeAgentGraph({
    inputText: input.inputText,
    initialMessages,
    provider: {
      id: provider.id,
      name: provider.name,
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      headers: provider.headers,
    },
    model: run.model,
    runId: run.id,
    userId,
    systemPrompt: '',
  });

  await updateAgentRunRepo(run.id, { status: result.status });
  return buildRunDetail(run.id);
}

export async function createAgentRunRecord(input: CreateAgentRunInput) {
  return createAgentRunRecordImpl(input);
}

async function streamAgentRunRecordImpl(
  input: CreateAgentRunInput,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const provider = await getRequiredActiveProviderForCurrentUser();
  const userId = getCurrentUserId();

  const run = await createAgentRunRepo({
    ...input,
    model: input.model === 'default' ? provider.model || 'default' : input.model,
  });

  const initialMessages = (input.initialMessages || []).filter(
    (m): m is { role: 'user' | 'assistant' | 'system'; content: string } =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
  );

  await emit({
    type: 'metadata',
    runId: run.id,
    model: run.model,
  });

  let currentState = buildEmptyRunState(toAgentRunDto(run), run.id);

  let state: AgentState;
  try {
    state = await streamAgentGraph({
      inputText: input.inputText,
      initialMessages,
      provider: {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        headers: provider.headers,
      },
      model: run.model,
      runId: run.id,
      userId,
      systemPrompt: '',
      onChunk: async (chunk) => {
        currentState = await emitGraphChunk(run, chunk, emit, currentState);
      },
    });
  } catch (error) {
    await updateAgentRunRepo(run.id, { status: 'failed' });
    throw error;
  }

  await updateAgentRunRepo(run.id, { status: state.status });
  const runRecord = await findAgentRunById(run.id);
  if (!runRecord) {
    throw new Error('Agent run was not created');
  }

  const detail = toStreamableRun(runRecord, state);
  await emit({ type: 'run_completed', run: detail });
  return detail;
}

export async function streamAgentRunRecord(
  input: CreateAgentRunInput,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return streamAgentRunRecordImpl(input, emit);
}

async function confirmAgentRunToolImpl(runId: string, toolExecutionId: string) {
  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('没有待确认的工具执行');
  }

  const result = await continueAgentGraph(runId, true);
  await updateAgentRunRepo(runId, { status: result.status });
  return buildRunDetail(runId);
}

export async function confirmAgentRunTool(runId: string, toolExecutionId: string) {
  return confirmAgentRunToolImpl(runId, toolExecutionId);
}

async function streamConfirmAgentRunToolImpl(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('娌℃湁寰呯‘璁ょ殑宸ュ叿鎵ц');
  }

  await emit({
    type: 'metadata',
    runId,
    model: current.model,
  });

  const runRecordBefore = await findAgentRunById(runId);
  let currentState = runRecordBefore
    ? buildEmptyRunState(toAgentRunDto(runRecordBefore), runId)
    : buildEmptyRunState({
        id: runId,
        sessionId: current.sessionId,
        status: current.status,
        inputText: current.inputText,
        model: current.model,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        version: current.version,
      }, runId);
  currentState = mergePartialState(currentState, {
    messages: current.messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
    finalText: current.finalText,
    iterationCount: current.iterationCount,
    assistantTextChunks: current.assistantTextChunks,
    timeline: current.timeline,
    status: current.status,
    requiresConfirmation: current.requiresConfirmation,
    error: current.error ?? null,
  });

  let state: AgentState;
  try {
    state = await streamContinueAgentGraph({
      runId,
      approved: true,
      onChunk: async (chunk) => {
        const runRecord = await findAgentRunById(runId);
        if (!runRecord) {
          return;
        }
        currentState = await emitGraphChunk(runRecord, chunk, emit, currentState);
      },
    });
  } catch (error) {
    await updateAgentRunRepo(runId, { status: 'failed' });
    throw error;
  }

  await updateAgentRunRepo(runId, { status: state.status });
  const runRecord = await findAgentRunById(runId);
  if (!runRecord) {
    return null;
  }

  const detail = toStreamableRun(runRecord, state);
  await emit({ type: 'run_completed', run: detail });
  return detail;
}

export async function streamConfirmAgentRunTool(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return streamConfirmAgentRunToolImpl(runId, toolExecutionId, emit);
}

async function rejectAgentRunToolImpl(runId: string, toolExecutionId: string) {
  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('没有待确认的工具执行');
  }

  const result = await continueAgentGraph(runId, false);
  await updateAgentRunRepo(runId, { status: result.status });
  return buildRunDetail(runId);
}

export async function rejectAgentRunTool(runId: string, toolExecutionId: string) {
  return rejectAgentRunToolImpl(runId, toolExecutionId);
}

async function streamRejectAgentRunToolImpl(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('娌℃湁寰呯‘璁ょ殑宸ュ叿鎵ц');
  }

  await emit({
    type: 'metadata',
    runId,
    model: current.model,
  });

  const runRecordBefore = await findAgentRunById(runId);
  let currentState = runRecordBefore
    ? buildEmptyRunState(toAgentRunDto(runRecordBefore), runId)
    : buildEmptyRunState({
        id: runId,
        sessionId: current.sessionId,
        status: current.status,
        inputText: current.inputText,
        model: current.model,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        version: current.version,
      }, runId);
  currentState = mergePartialState(currentState, {
    messages: current.messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
    finalText: current.finalText,
    iterationCount: current.iterationCount,
    assistantTextChunks: current.assistantTextChunks,
    timeline: current.timeline,
    status: current.status,
    requiresConfirmation: current.requiresConfirmation,
    error: current.error ?? null,
  });

  let state: AgentState;
  try {
    state = await streamContinueAgentGraph({
      runId,
      approved: false,
      onChunk: async (chunk) => {
        const runRecord = await findAgentRunById(runId);
        if (!runRecord) {
          return;
        }
        currentState = await emitGraphChunk(runRecord, chunk, emit, currentState);
      },
    });
  } catch (error) {
    await updateAgentRunRepo(runId, { status: 'failed' });
    throw error;
  }

  await updateAgentRunRepo(runId, { status: state.status });
  const runRecord = await findAgentRunById(runId);
  if (!runRecord) {
    return null;
  }

  const detail = toStreamableRun(runRecord, state);
  await emit({ type: 'run_completed', run: detail });
  return detail;
}

export async function streamRejectAgentRunTool(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return streamRejectAgentRunToolImpl(runId, toolExecutionId, emit);
}

export async function getAgentRunDetail(id: string) {
  return buildRunDetail(id);
}

export async function updateAgentRunRecord(id: string, input: UpdateAgentRunInput) {
  const existing = await findAgentRunById(id);
  if (!existing) {
    return null;
  }

  const run = await updateAgentRunRepo(id, input);
  return toAgentRunDto(run);
}

export async function deleteAgentRunRecord(id: string) {
  const deleted = await deleteAgentRunById(id);
  if (!deleted) {
    return null;
  }

  await getCheckpointer().deleteThread(id);
  return { id: deleted.id, deleted: true };
}
