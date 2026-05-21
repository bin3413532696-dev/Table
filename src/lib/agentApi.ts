import { fetchWithAuth } from './auth';

export type AgentRunStatus = 'pending' | 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
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

export interface AgentSessionDto {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  runs: AgentRunDto[];
}

export interface AgentSessionDetailDto extends AgentSessionDto {
  messages: AgentRunMessageDto[];
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

// ============ Session APIs ============

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

  const response = await fetchWithAuth(`/api/agent/sessions?${query}`);
  if (!response.ok) {
    let message = `Failed to fetch agent sessions: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentSessionListResponse>;
}

export async function fetchAgentSessionDetail(sessionId: string): Promise<AgentSessionDetailDto> {
  const response = await fetchWithAuth(`/api/agent/sessions/${sessionId}`);
  if (!response.ok) {
    let message = `Failed to fetch agent session detail: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentSessionDetailDto>;
}

export async function createAgentSession(title?: string): Promise<AgentSessionDto> {
  const response = await fetchWithAuth('/api/agent/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    let message = `Failed to create agent session: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentSessionDto>;
}

export async function updateAgentSession(sessionId: string, title: string): Promise<AgentSessionDto> {
  const response = await fetchWithAuth(`/api/agent/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    let message = `Failed to update agent session: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentSessionDto>;
}

export async function deleteAgentSessionApi(sessionId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/agent/sessions/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    let message = `Failed to delete agent session: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }
}

// ============ Run APIs ============

export async function fetchAgentRuntimeStatus(): Promise<AgentRuntimeStatusDto> {
  const response = await fetchWithAuth('/api/agent/health');
  if (!response.ok) {
    let message = `Failed to load agent runtime status: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRuntimeStatusDto>;
}

export async function streamAgentRun(
  input: {
    inputText: string;
    model: string;
    sessionId?: string; // 可选，首次对话时后端自动创建
    initialMessages?: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    }>;
  },
  handlers: {
    onEvent?: (event: AgentRunStreamEvent) => void;
    onDone?: () => void;
  } = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth('/api/agent/runs/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    // SSE 超时 5 分钟：配合后端 SSE_TIMEOUT_MS，前端 AbortController 作为最终保险
    signal: signal ?? new AbortController().signal,
  });

  if (!response.ok || !response.body) {
    let message = `Failed to stream agent run: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalRun: AgentRunDetailDto | null = null;

  const flushEventBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    let payload: AgentRunStreamEvent | { ok?: boolean; message?: string };
    try {
      payload = JSON.parse(dataLines.join('\n')) as AgentRunStreamEvent | { ok?: boolean; message?: string };
    } catch {
      console.error('[Agent] Failed to parse SSE event block');
      return;
    }

    if (eventName === 'error') {
      throw new Error('message' in payload && payload.message ? payload.message : 'Agent stream failed');
    }

    if (eventName === 'done') {
      handlers.onDone?.();
      return;
    }

    const typedPayload = payload as AgentRunStreamEvent;
    handlers.onEvent?.(typedPayload);
    if (typedPayload.run) {
      finalRun = typedPayload.run;
    }
  };

  while (true) {
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

async function streamToolDecision(
  path: string,
  handlers: {
    onEvent?: (event: AgentRunStreamEvent) => void;
    onDone?: () => void;
  } = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth(path, {
    method: 'POST',
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `Failed to stream agent run: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalRun: AgentRunDetailDto | null = null;

  const flushEventBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    let payload: AgentRunStreamEvent | { ok?: boolean; message?: string };
    try {
      payload = JSON.parse(dataLines.join('\n')) as AgentRunStreamEvent | { ok?: boolean; message?: string };
    } catch {
      console.error('[Agent] Failed to parse SSE event block');
      return;
    }

    if (eventName === 'error') {
      throw new Error('message' in payload && payload.message ? payload.message : 'Agent stream failed');
    }

    if (eventName === 'done') {
      handlers.onDone?.();
      return;
    }

    const typedPayload = payload as AgentRunStreamEvent;
    handlers.onEvent?.(typedPayload);
    if (typedPayload.run) {
      finalRun = typedPayload.run;
    }
  };

  while (true) {
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

  const response = await fetchWithAuth(`/api/agent/runs?${query}`);
  if (!response.ok) {
    let message = `Failed to fetch agent runs: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunListResponse>;
}

export async function fetchAgentRunDetail(runId: string): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth(`/api/agent/runs/${runId}`);
  if (!response.ok) {
    let message = `Failed to fetch agent run detail: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
}

export async function deleteAgentRunApi(runId: string): Promise<{ id: string; deleted: boolean }> {
  const response = await fetchWithAuth(`/api/agent/runs/${runId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    let message = `Failed to delete agent run: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<{ id: string; deleted: boolean }>;
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
  const response = await fetchWithAuth('/api/agent/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `Failed to create agent run: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
}

export async function confirmAgentToolExecution(input: {
  runId: string;
  toolExecutionId: string;
}): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth(`/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/confirm`, {
    method: 'POST',
  });

  if (!response.ok) {
    let message = `Failed to confirm tool execution: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
}

export async function streamConfirmAgentToolExecution(
  input: {
    runId: string;
    toolExecutionId: string;
  },
  handlers: {
    onEvent?: (event: AgentRunStreamEvent) => void;
    onDone?: () => void;
  } = {},
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
  const response = await fetchWithAuth(`/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/reject`, {
    method: 'POST',
  });

  if (!response.ok) {
    let message = `Failed to reject tool execution: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
}

export async function streamRejectAgentToolExecution(
  input: {
    runId: string;
    toolExecutionId: string;
  },
  handlers: {
    onEvent?: (event: AgentRunStreamEvent) => void;
    onDone?: () => void;
  } = {},
  signal?: AbortSignal
): Promise<AgentRunDetailDto> {
  return streamToolDecision(
    `/api/agent/runs/${input.runId}/tools/${input.toolExecutionId}/reject/stream`,
    handlers,
    signal
  );
}

// ============ Persona APIs ============

export interface AgentPersonaDto {
  systemPrompt: string;
}

export async function fetchAgentPersona(): Promise<AgentPersonaDto> {
  const response = await fetchWithAuth('/api/agent/persona');
  if (!response.ok) {
    let message = `Failed to fetch agent persona: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentPersonaDto>;
}

export async function updateAgentPersona(systemPrompt: string): Promise<AgentPersonaDto> {
  const response = await fetchWithAuth('/api/agent/persona', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ systemPrompt }),
  });

  if (!response.ok) {
    let message = `Failed to update agent persona: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string; details?: unknown };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.details) {
        message += `: ${JSON.stringify(payload.details)}`;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentPersonaDto>;
}