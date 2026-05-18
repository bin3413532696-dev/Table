import {
  createAgentRun as createAgentRunRepo,
  findAgentRunById,
  listAgentRuns,
  updateAgentRun as updateAgentRunRepo,
  deleteAgentRunById,
} from './repository';
import { executeAgentGraph, continueAgentGraph, agentGraph } from './langgraph/graph';
import { toAgentRunDto, buildAgentRunDetailDto } from './dto';
import type {
  CreateAgentRunInput,
  ListAgentRunsQuery,
  UpdateAgentRunInput,
} from './schema';
import { getActiveProviderForCurrentUser, getRequiredActiveProviderForCurrentUser } from '../providers/service';
import { getCurrentUserId } from '../../shared/user-context';
import { getCheckpointer } from './langgraph/postgres-checkpointer';
import type { RunStatus } from './langgraph/state';

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

export async function createAgentRunRecord(input: CreateAgentRunInput) {
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

export async function streamAgentRunRecord(
  input: CreateAgentRunInput,
  emit: (event: unknown) => Promise<void> | void
) {
  const result = await createAgentRunRecord(input);
  if (!result) {
    throw new Error('Agent run was not created');
  }
  await emit({ type: 'run_completed', run: result });
  return result;
}

export async function confirmAgentRunTool(runId: string, toolExecutionId: string) {
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

export async function rejectAgentRunTool(runId: string, toolExecutionId: string) {
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
