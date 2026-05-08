import { fetchWithAuth } from './auth';

export interface AgentRunMessageDto {
  id: string;
  runId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sequence: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface AgentRunToolExecutionDto {
  id: string;
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: string;
  requiresConfirmation: boolean;
  confirmationRequestedAt?: number;
  confirmedAt?: number;
  result?: Record<string, unknown>;
  errorMessage?: string;
  sequence: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRunDetailDto {
  id: string;
  sessionId?: string;
  status: string;
  inputText: string;
  model: string;
  requiresConfirmation: boolean;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  messages: AgentRunMessageDto[];
  toolExecutions: AgentRunToolExecutionDto[];
  snapshots: Array<{
    id: string;
    runId: string;
    snapshot: Record<string, unknown>;
    createdAt: number;
  }>;
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
  type: 'run_created' | 'status' | 'run_completed' | 'run_waiting_confirmation' | 'run_failed' | 'run_cancelled' | 'text_chunk' | 'tool_call' | 'tool_result';
  run?: AgentRunDetailDto;
  runId?: string;
  status?: 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';
  text?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}

export async function fetchAgentRuntimeStatus(): Promise<AgentRuntimeStatusDto> {
  const response = await fetchWithAuth('/api/agent/health');
  if (!response.ok) {
    let message = `Failed to load agent runtime status: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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
    initialMessages?: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    }>;
  },
  handlers: {
    onEvent?: (event: AgentRunStreamEvent) => void;
    onTextChunk?: (text: string) => void;
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
    onToolResult?: (toolName: string, result: unknown) => void;
    onDone?: () => void;
  } = {}
): Promise<AgentRunDetailDto> {
  const response = await fetchWithAuth('/api/agent/runs/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || !response.body) {
    let message = `Failed to stream agent run: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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

    if (typedPayload.type === 'text_chunk' && typedPayload.text) {
      handlers.onTextChunk?.(typedPayload.text);
    }

    if (typedPayload.type === 'tool_call' && typedPayload.toolName && typedPayload.arguments) {
      handlers.onToolCall?.(typedPayload.toolName, typedPayload.arguments);
    }

    if (typedPayload.type === 'tool_result' && typedPayload.toolName && typedPayload.result) {
      handlers.onToolResult?.(typedPayload.toolName, typedPayload.result);
    }

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

export interface AgentRunDto {
  id: string;
  sessionId?: string;
  status: string;
  inputText: string;
  model: string;
  requiresConfirmation: boolean;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface AgentRunListResponse {
  items: AgentRunDto[];
  total: number;
  source: string;
}

export async function fetchAgentRunList(params?: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<AgentRunListResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.status) query.set('status', params.status);

  const response = await fetchWithAuth(`/api/agent/runs?${query}`);
  if (!response.ok) {
    let message = `Failed to fetch agent runs: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let message = `Failed to confirm tool execution: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
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
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentRunDetailDto>;
}
