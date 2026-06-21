import { requestApi } from '../../../shared/api/client';
import { isRecord, readArrayField, readStringField } from '../../../shared/api/guards';
import { normalizeApiErrorPayload } from '../../../shared/api/error';
import { fetchWithAuth } from '../../../shared/auth';

export type AgentRunStatus = 'pending' | 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt?: number;
}

export interface AgentRunToolExecutionDto {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: string;
  requiresConfirmation?: boolean;
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt?: number;
}

export interface TimelineEvent {
  type: 'llm_start' | 'llm_end' | 'tool_start' | 'tool_end' | 'confirmation' | 'interrupted';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface AgentRunDto {
  id: string;
  sessionId: string;
  status: string;
  inputText: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface AgentRunDetailDto extends AgentRunDto {
  status: AgentRunStatus;
  messages: AgentRunMessageDto[];
  executedToolCalls: AgentRunToolExecutionDto[];
  pendingToolCalls: AgentRunToolExecutionDto[];
  requiresConfirmation: boolean;
  finalText: string;
  error?: string;
  iterationCount: number;
  assistantTextChunks: string[];
  timeline: TimelineEvent[];
}

export interface AgentSessionGoalDto {
  title: string;
  status: string;
}

export interface AgentSessionTodoDto {
  title: string;
  status: string;
  dueHint?: string | null;
  sourceRunId?: string | null;
}

export interface AgentSessionMemoryDto {
  summary: string;
  preferences: string[];
  facts: string[];
  goals: AgentSessionGoalDto[];
  todos: AgentSessionTodoDto[];
  rules: string[];
  status: 'idle' | 'pending' | 'processing' | 'ready' | 'failed';
  updatedAt?: number | null;
  disabled: boolean;
  runCount: number;
}

export interface AgentSessionDto {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  memoryStatus: 'idle' | 'pending' | 'processing' | 'ready' | 'failed';
  memoryDisabled: boolean;
  memoryUpdatedAt?: number | null;
  memoryRunCount: number;
  runs: AgentRunDto[];
}

export interface AgentSessionDetailDto extends AgentSessionDto {
  messages: AgentRunMessageDto[];
  memory: AgentSessionMemoryDto;
}

export interface AgentRuntimeStatusDto {
  ok: boolean;
  module: string;
  stage: string;
  runtime: {
    connected: boolean;
    selectedModel: string;
    availableModels: string[];
    provider: null | {
      id: string;
      name: string;
      apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
      baseUrl: string;
      hasApiKey: boolean;
    };
  };
}

export interface AgentToolCapabilityDto {
  name: string;
  description: string;
  promptSignature: string;
  category: 'query' | 'mutation' | 'system';
  module: string;
  requiresConfirmation: boolean;
  requiresRag: boolean;
  enabled: boolean;
}

export interface AgentProviderCapabilityDto {
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  label: string;
  enabled: boolean;
}

export interface AgentCapabilitiesDto {
  tools: AgentToolCapabilityDto[];
  providers: AgentProviderCapabilityDto[];
}

export interface AgentRunStreamEvent {
  type: 'metadata' | 'langgraph_chunk' | 'token' | 'run_update' | 'run_completed';
  runId?: string;
  sessionId?: string;
  model?: string;
  mode?: 'messages' | 'tasks';
  chunk?: unknown;
  token?: string;
  run?: AgentRunDetailDto;
}

export interface AgentErrorStreamEvent {
  type: 'error';
  message: string;
}

export interface AgentDoneStreamEvent {
  type: 'done';
  ok?: boolean;
}

type AgentStreamEnvelope =
  | AgentRunStreamEvent
  | AgentErrorStreamEvent
  | AgentDoneStreamEvent;

export interface AgentLangGraphChunkPayload {
  mode?: 'messages' | 'tasks';
  chunk: unknown[];
}

export function extractMessageTextFromLangGraphChunk(event: AgentRunStreamEvent): string {
  if (event.type !== 'langgraph_chunk' || event.mode !== 'messages' || !Array.isArray(event.chunk)) {
    return '';
  }

  const tuple = event.chunk;
  const messageChunk = tuple[1];
  if (!isRecord(messageChunk)) {
    return '';
  }

  const content = messageChunk.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      return isRecord(part) ? (readStringField(part, 'text') || '') : '';
    })
    .join('');
}

type AgentStreamHandlers = {
  onEvent?: (event: AgentRunStreamEvent) => void;
  onDone?: () => void;
};

async function buildStreamErrorMessage(response: Response, fallback: string): Promise<string> {
  let message = `${fallback}: HTTP ${response.status}`;

  try {
    const payload = normalizeApiErrorPayload(await response.json());
    if (payload?.message) {
      message = payload.message;
    }
    if (payload?.details) {
      message += `: ${JSON.stringify(payload.details)}`;
    }
  } catch {
    // noop
  }

  return message;
}

function parseAgentStreamPayload(eventName: string, rawPayload: unknown): AgentStreamEnvelope | null {
  if (!isRecord(rawPayload)) {
    return null;
  }

  if (eventName === 'error') {
    return {
      type: 'error',
      message: readStringField(rawPayload, 'message') || 'Agent stream failed',
    };
  }

  if (eventName === 'done') {
    return {
      type: 'done',
      ok: typeof rawPayload.ok === 'boolean' ? rawPayload.ok : undefined,
    };
  }

  const type = readStringField(rawPayload, 'type');
  if (!type) {
    return null;
  }

  if (type === 'langgraph_chunk') {
    return {
      type,
      mode: rawPayload.mode === 'messages' || rawPayload.mode === 'tasks' ? rawPayload.mode : undefined,
      chunk: readArrayField(rawPayload, 'chunk') || undefined,
    };
  }

  if (
    type === 'metadata' ||
    type === 'token' ||
    type === 'run_update' ||
    type === 'run_completed'
  ) {
    return {
      type,
      runId: readStringField(rawPayload, 'runId') || undefined,
      sessionId: readStringField(rawPayload, 'sessionId') || undefined,
      model: readStringField(rawPayload, 'model') || undefined,
      token: readStringField(rawPayload, 'token') || undefined,
      run: (rawPayload.run as AgentRunDetailDto | undefined) ?? undefined,
    };
  }

  return null;
}

async function readAgentEventStream(
  response: Response,
  handlers: AgentStreamHandlers = {}
): Promise<AgentRunDetailDto> {
  if (!response.ok || !response.body) {
    throw new Error(await buildStreamErrorMessage(response, 'Failed to stream agent run'));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalRun: AgentRunDetailDto | null = null;

  const flushEventBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    let eventId: string | null = null;
    let retryMs: number | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith('id:')) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith('retry:')) {
        const parsedRetry = Number.parseInt(line.slice(6).trim(), 10);
        retryMs = Number.isFinite(parsedRetry) ? parsedRetry : null;
      }
    }

    void eventId;
    void retryMs;

    if (dataLines.length === 0) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      console.error('[Agent] Failed to parse SSE event block');
      return;
    }

    const parsedPayload = parseAgentStreamPayload(eventName, payload);
    if (!parsedPayload) {
      return;
    }

    if (parsedPayload.type === 'error') {
      throw new Error(parsedPayload.message);
    }

    if (parsedPayload.type === 'done') {
      handlers.onDone?.();
      return;
    }

    handlers.onEvent?.(parsedPayload);
    if ('run' in parsedPayload && parsedPayload.run) {
      finalRun = parsedPayload.run;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      if (block.trim()) {
        flushEventBlock(block.trim());
      }
    }
  }

  if (buffer.trim()) {
    flushEventBlock(buffer.trim());
  }

  if (!finalRun) {
    throw new Error('Agent stream finished without final run payload');
  }

  return finalRun;
}

export interface AgentSessionListResponse {
  items: AgentSessionDto[];
  total: number;
}

export async function fetchAgentSessionList(params?: {
  limit?: number;
  offset?: number;
}): Promise<AgentSessionListResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  return requestApi<AgentSessionListResponse>(`/api/agent/sessions?${query.toString()}`);
}

export async function fetchAgentSessionDetail(sessionId: string): Promise<AgentSessionDetailDto> {
  return requestApi<AgentSessionDetailDto>(`/api/agent/sessions/${sessionId}`);
}

export async function fetchAgentSessionMemory(sessionId: string): Promise<AgentSessionMemoryDto> {
  return requestApi<AgentSessionMemoryDto>(`/api/agent/sessions/${sessionId}/memory`);
}

export async function createAgentSession(title?: string): Promise<AgentSessionDto> {
  return requestApi<AgentSessionDto>('/api/agent/sessions', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function updateAgentSession(sessionId: string, title: string): Promise<AgentSessionDto> {
  return requestApi<AgentSessionDto>(`/api/agent/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteAgentSessionApi(sessionId: string): Promise<void> {
  await requestApi<void>(`/api/agent/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export async function updateAgentSessionMemorySettings(
  sessionId: string,
  input: { disabled: boolean }
): Promise<AgentSessionMemoryDto> {
  return requestApi<AgentSessionMemoryDto>(`/api/agent/sessions/${sessionId}/memory/settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteAgentSessionMemory(sessionId: string): Promise<AgentSessionMemoryDto> {
  return requestApi<AgentSessionMemoryDto>(`/api/agent/sessions/${sessionId}/memory`, {
    method: 'DELETE',
  });
}

export async function fetchAgentRuntimeStatus(): Promise<AgentRuntimeStatusDto> {
  return requestApi<AgentRuntimeStatusDto>('/api/agent/health');
}

export async function fetchAgentCapabilities(): Promise<AgentCapabilitiesDto> {
  return requestApi<AgentCapabilitiesDto>('/api/agent/capabilities');
}

export async function streamAgentRun(
  input: {
    inputText: string;
    model: string;
    sessionId?: string;
    ragEnabled?: boolean;
    initialMessages?: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    }>;
  },
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth('/api/agent/runs/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: signal ?? new AbortController().signal,
  });

  return readAgentEventStream(response, handlers);
}

async function streamToolDecision(
  path: string,
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth(path, {
    method: 'POST',
    signal,
  });

  return readAgentEventStream(response, handlers);
}

export interface AgentRunListResponse {
  items: AgentRunDto[];
  total: number;
  source: string;
}

export async function fetchAgentRunList(params?: {
  limit?: number;
  offset?: number;
  sessionId?: string;
  status?: string;
}): Promise<AgentRunListResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.sessionId) query.set('sessionId', params.sessionId);
  if (params?.status) query.set('status', params.status);

  return requestApi<AgentRunListResponse>(`/api/agent/runs?${query.toString()}`);
}

export async function fetchAgentRunDetail(runId: string): Promise<AgentRunDetailDto> {
  return requestApi<AgentRunDetailDto>(`/api/agent/runs/${runId}`);
}

export async function deleteAgentRunApi(runId: string): Promise<{ id: string; deleted: boolean }> {
  return requestApi<{ id: string; deleted: boolean }>(`/api/agent/runs/${runId}`, {
    method: 'DELETE',
  });
}

export async function createAgentRun(input: {
  inputText: string;
  model: string;
  sessionId: string;
  initialMessages?: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}): Promise<AgentRunDetailDto> {
  return requestApi<AgentRunDetailDto>('/api/agent/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function confirmAgentToolExecution(input: {
  runId: string;
  toolExecutionId: string;
}): Promise<AgentRunDetailDto> {
  return requestApi<AgentRunDetailDto>(`/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/confirm`, {
    method: 'POST',
  });
}

export async function streamConfirmAgentToolExecution(
  input: {
    runId: string;
    toolExecutionId: string;
  },
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  return streamToolDecision(
    `/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/confirm/stream`,
    handlers,
    signal
  );
}

export async function rejectAgentToolExecution(input: {
  runId: string;
  toolExecutionId: string;
}): Promise<AgentRunDetailDto> {
  return requestApi<AgentRunDetailDto>(`/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/reject`, {
    method: 'POST',
  });
}

export async function streamRejectAgentToolExecution(
  input: {
    runId: string;
    toolExecutionId: string;
  },
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  return streamToolDecision(
    `/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/reject/stream`,
    handlers,
    signal
  );
}

export interface AgentPersonaDto {
  systemPrompt: string;
}

export async function fetchAgentPersona(): Promise<AgentPersonaDto> {
  return requestApi<AgentPersonaDto>('/api/agent/persona');
}

export async function updateAgentPersona(systemPrompt: string): Promise<AgentPersonaDto> {
  return requestApi<AgentPersonaDto>('/api/agent/persona', {
    method: 'PUT',
    body: JSON.stringify({ systemPrompt }),
  });
}
