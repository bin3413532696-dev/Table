import { prisma } from '../../db/client';
import {
  createAgentRun as createAgentRunRepo,
  createAgentSession as createAgentSessionRepo,
  findAgentRunById,
  findAgentSessionById,
  listAgentRuns,
  listAgentSessions,
  updateAgentRun as updateAgentRunRepo,
  updateAgentSession,
  deleteAgentRunById,
  deleteAgentSession,
  getAgentPersonaPrefs,
  updateAgentPersonaPrefs,
} from './repository';
import {
  executeAgentGraph,
  continueAgentGraph,
  agentGraph,
  streamAgentGraph,
  streamAgentGraphDirect,
  streamContinueAgentGraph,
  type AgentGraphStreamChunk,
} from './langgraph/graph';
import { toAgentRunDto, buildAgentRunDetailDto, toAgentSessionDto, buildAgentSessionDetailDto } from './dto';
import type {
  CreateAgentRunInput,
  ListAgentRunsQuery,
  UpdateAgentRunInput,
  CreateAgentSessionInput,
  ListAgentSessionsQuery,
  UpdateAgentPersonaInput,
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

/**
 * 根据用户输入生成会话标题
 * 取前 40 个字符，超过则截断加省略号
 */
function generateSessionTitle(inputText: string): string {
  const trimmed = inputText.trim();
  if (trimmed.length === 0) {
    return '新会话';
  }
  if (trimmed.length <= 40) {
    return trimmed;
  }
  return trimmed.slice(0, 40) + '...';
}

/**
 * 核心改变：threadId 使用 sessionId 而非 runId
 * 这样同一 session 的多个 run 共享同一个 LangGraph checkpoint thread
 */
function resolveThreadId(runId: string, sessionId?: string | null) {
  return sessionId || runId;
}

async function getCheckpointState(runId: string, sessionId?: string | null) {
  const threadId = resolveThreadId(runId, sessionId);
  const snapshot = await agentGraph.getState({
    configurable: { thread_id: threadId },
  });
  if (snapshot?.values) {
    const values = snapshot.values as Partial<AgentState> | undefined;
    if (values?.runId === runId) {
      return snapshot;
    }
    // 对于同一 session 的后续 run，checkpoint 中的 runId 可能不存在
    // 但 sessionId 相同，所以返回 snapshot
    if (sessionId) {
      return snapshot;
    }
  }
  return null;
}

async function buildRunDetail(runId: string) {
  const run = await findAgentRunById(runId);
  if (!run) {
    return null;
  }

  try {
    const state = await getCheckpointState(runId, run.sessionId);
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
    modelInputMessages: [],
    executedToolCalls: [],
    pendingToolCalls: [],
    requiresConfirmation: false,
    pendingToolExecution: null,
    confirmedToolCall: null,
    finalText: '',
    runId,
    userId: '',
    iterationCount: 0,
    inputAppended: false,
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
  | { type: 'metadata'; runId: string; model: string; sessionId: string }
  | { type: 'langgraph_chunk'; mode: 'messages' | 'tasks' | 'token'; chunk: unknown }
  | { type: 'token'; token: string }
  | { type: 'run_update'; run: ReturnType<typeof buildAgentRunDetailDto> }
  | { type: 'run_completed'; run: ReturnType<typeof buildAgentRunDetailDto> };

function toStreamableRun(
  runRecord: NonNullable<Awaited<ReturnType<typeof findAgentRunById>>>,
  state?: AgentState
) {
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

/**
 * 状态修复：服务启动时调用，修复异常终止的会话
 */
export async function repairZombieSessions() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const result = await prisma.agentRun.updateMany({
    where: {
      status: { in: ['running', 'waiting_confirmation'] },
      updatedAt: { lt: fiveMinutesAgo },
    },
    data: {
      status: 'failed',
    },
  });
  return result.count;
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

// ============ Session CRUD ============

export async function getAgentSessionList(input: ListAgentSessionsQuery) {
  const { items, total } = await listAgentSessions(input);
  return {
    items: items.map((session) => toAgentSessionDto(session)),
    total,
  };
}

export async function getAgentSessionDetail(id: string) {
  const session = await findAgentSessionById(id);
  if (!session) {
    return null;
  }

  // 尝试从 checkpoint 获取会话的完整对话历史
  try {
    const snapshot = await agentGraph.getState({
      configurable: { thread_id: id },
    });

    if (snapshot?.values) {
      const state = snapshot.values as AgentState | undefined;
      // 验证 checkpoint 中的消息是否有效
      if (state?.messages && state.messages.length > 0) {
        return buildAgentSessionDetailDto(session, state);
      }
    }
  } catch (error) {
    // 记录 checkpoint 获取错误，便于调试
    console.error('[Agent] Failed to get checkpoint for session:', id, error);
  }

  // 没有 checkpoint 数据时返回基本会话信息，但包含 runs 用于前端降级显示
  return buildAgentSessionDetailDto(session, null);
}

export async function createAgentSessionRecord(input: CreateAgentSessionInput) {
  const session = await createAgentSessionRepo(input);
  return toAgentSessionDto(session);
}

export async function updateAgentSessionRecord(id: string, input: { title: string }) {
  const session = await updateAgentSession(id, input);
  return toAgentSessionDto(session);
}

export async function deleteAgentSessionRecord(id: string) {
  const result = await deleteAgentSession(id);
  if (!result) {
    return null;
  }

  // 删除 session 级别的 checkpoint
  // 注意：所有 runs 共享同一个 thread_id (sessionId)，所以只需删除一次
  const checkpointer = getCheckpointer();
  try {
    await checkpointer.deleteThread(id);
  } catch (error) {
    // 记录删除失败，便于调试
    console.error('[Agent] Failed to delete checkpoint for session:', id, error);
  }

  return { id: result.id, deleted: true };
}

// ============ Run CRUD ============

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

  // 获取用户人格配置
  const persona = await getAgentPersonaPrefs();
  const effectiveSystemPrompt = input.systemPrompt || persona.systemPrompt || '';

  // 获取或创建 session
  let actualSessionId: string;
  if (input.sessionId) {
    const existingSession = await findAgentSessionById(input.sessionId);
    if (existingSession) {
      actualSessionId = input.sessionId;
      // 如果是已有会话且标题是默认的"新会话"，则根据输入更新标题
      if (existingSession.title === '新会话') {
        await updateAgentSession(actualSessionId, { title: generateSessionTitle(input.inputText) });
      }
    } else {
      // sessionId 传入但不存在于数据库，创建新 session
      const newSession = await createAgentSessionRepo({ title: generateSessionTitle(input.inputText) });
      actualSessionId = newSession.id;
    }
  } else {
    // 没有传入 sessionId，创建新 session
    const newSession = await createAgentSessionRepo({ title: generateSessionTitle(input.inputText) });
    actualSessionId = newSession.id;
  }

  const run = await createAgentRunRepo({
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    sessionId: actualSessionId,
    model: input.model === 'default' ? provider.model || 'default' : input.model,
  });

  // 更新 session 的 updatedAt
  await updateAgentSession(actualSessionId, {});

  const initialMessages = (input.initialMessages || []).filter(
    (m): m is { role: 'user' | 'assistant' | 'system'; content: string } =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
  );

  // 关键：threadId 使用 sessionId，实现多轮对话上下文共享
  const threadId = resolveThreadId(run.id, actualSessionId);

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
    threadId,
    userId,
    systemPrompt: effectiveSystemPrompt,
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

  // 获取用户人格配置
  const persona = await getAgentPersonaPrefs();
  const effectiveSystemPrompt = input.systemPrompt || persona.systemPrompt || '';
  console.log('[Agent] Stream persona:', {
    inputSessionId: input.sessionId,
    personaLength: persona.systemPrompt.length,
    effectiveLength: effectiveSystemPrompt.length,
    preview: effectiveSystemPrompt.slice(0, 100)
  });

  // 获取或创建 session
  let actualSessionId: string;
  if (input.sessionId) {
    const existingSession = await findAgentSessionById(input.sessionId);
    if (existingSession) {
      actualSessionId = input.sessionId;
      // 如果是已有会话且标题是默认的"新会话"，则根据输入更新标题
      if (existingSession.title === '新会话') {
        await updateAgentSession(actualSessionId, { title: generateSessionTitle(input.inputText) });
      }
    } else {
      const newSession = await createAgentSessionRepo({ title: generateSessionTitle(input.inputText) });
      actualSessionId = newSession.id;
    }
  } else {
    const newSession = await createAgentSessionRepo({ title: generateSessionTitle(input.inputText) });
    actualSessionId = newSession.id;
  }

  const run = await createAgentRunRepo({
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    sessionId: actualSessionId,
    model: input.model === 'default' ? provider.model || 'default' : input.model,
  });

  // 更新 session 的 updatedAt，确保会话列表排序正确
  await updateAgentSession(actualSessionId, {});

  const initialMessages = (input.initialMessages || []).filter(
    (m): m is { role: 'user' | 'assistant' | 'system'; content: string } =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
  );

  await emit({
    type: 'metadata',
    runId: run.id,
    model: run.model,
    sessionId: actualSessionId,
  });

  let currentState = buildEmptyRunState(toAgentRunDto(run), run.id);

  // 关键：threadId 使用 sessionId
  const threadId = resolveThreadId(run.id, actualSessionId);

  let state: AgentState;
  try {
    // 使用直接流式执行，绕过LangGraph节点内部的stream消费问题
    state = await streamAgentGraphDirect({
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
      threadId,
      userId,
      systemPrompt: effectiveSystemPrompt,
      // token级流式回调：直接发送token到前端
      onToken: async (token) => {
        await emit({ type: 'token', token });
      },
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

async function decideToolExecutionImpl(runId: string, toolExecutionId: string, approved: boolean) {
  const runRecord = await findAgentRunById(runId);
  if (!runRecord) {
    return null;
  }
  const threadId = resolveThreadId(runId, runRecord.sessionId);

  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('没有待确认的工具执行');
  }

  const result = await continueAgentGraph(threadId, approved);
  await updateAgentRunRepo(runId, { status: result.status });
  return buildRunDetail(runId);
}

export async function confirmAgentRunTool(runId: string, toolExecutionId: string) {
  return decideToolExecutionImpl(runId, toolExecutionId, true);
}

export async function rejectAgentRunTool(runId: string, toolExecutionId: string) {
  return decideToolExecutionImpl(runId, toolExecutionId, false);
}

async function streamToolDecisionImpl(
  runId: string,
  toolExecutionId: string,
  approved: boolean,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  const runRecord = await findAgentRunById(runId);
  if (!runRecord) {
    return null;
  }
  const threadId = resolveThreadId(runId, runRecord.sessionId);

  const current = await buildRunDetail(runId);
  if (!current) {
    return null;
  }

  const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
  if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
    throw new Error('没有待确认的工具执行');
  }

  await emit({
    type: 'metadata',
    runId,
    model: current.model,
    sessionId: runRecord.sessionId,
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
      threadId,
      approved,
      onChunk: async (chunk) => {
        const runRecord = runRecordBefore ?? {
          id: runId,
          userId: '',
          sessionId: current.sessionId ?? '',
          status: current.status,
          inputText: current.inputText,
          model: current.model,
          version: 0,
          createdAt: new Date(current.createdAt),
          updatedAt: new Date(current.updatedAt),
        };
        currentState = await emitGraphChunk(runRecord, chunk, emit, currentState);
      },
      // token级流式回调
      onToken: async (token) => {
        await emit({ type: 'token', token });
      },
    });
  } catch (error) {
    await updateAgentRunRepo(runId, { status: 'failed' });
    throw error;
  }

  await updateAgentRunRepo(runId, { status: state.status });
  const runRecordAfter = await findAgentRunById(runId);
  if (!runRecordAfter) {
    return null;
  }

  const detail = toStreamableRun(runRecordAfter, state);
  await emit({ type: 'run_completed', run: detail });
  return detail;
}

export async function streamConfirmAgentRunTool(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return streamToolDecisionImpl(runId, toolExecutionId, true, emit);
}

export async function streamRejectAgentRunTool(
  runId: string,
  toolExecutionId: string,
  emit: (event: AgentRunStreamEvent) => Promise<void> | void
) {
  return streamToolDecisionImpl(runId, toolExecutionId, false, emit);
}

export async function getAgentRunDetail(id: string) {
  return buildRunDetail(id);
}

export async function updateAgentRunRecord(id: string, input: UpdateAgentRunInput) {
  const existing = await findAgentRunById(id);
  if (!existing) {
    return null;
  }

  const updated = await updateAgentRunRepo(id, input, input.version);
  if (!updated) {
    return null;
  }
  return toAgentRunDto(updated);
}

/**
 * 删除 AgentRun
 * 事务化操作，检查运行状态，异步清理 checkpoint
 */
export async function deleteAgentRunRecord(id: string) {
  const run = await findAgentRunById(id);
  if (!run) {
    return null;
  }

  // 禁止删除运行中的会话
  if (run.status === 'running' || run.status === 'waiting_confirmation') {
    throw new Error('无法删除运行中的会话');
  }

  const deleted = await deleteAgentRunById(id);
  if (!deleted) {
    return null;
  }

  // 注意：不删除 checkpoint
  // 因为 thread_id 是 sessionId，checkpoint 是 session 级别共享的
  // 删除单个 run 不应影响其他 runs 的数据
  // 只有删除整个 session 时才删除 checkpoint

  return { id: deleted.id, deleted: true };
}

// ============ Agent Persona ============

export async function getAgentPersona() {
  return getAgentPersonaPrefs();
}

export async function updateAgentPersona(input: UpdateAgentPersonaInput) {
  return updateAgentPersonaPrefs(input);
}