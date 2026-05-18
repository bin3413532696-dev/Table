import type { AgentRun } from '@prisma/client';
import type { AgentState, RunStatus } from './langgraph/state';

export type AgentRunListItemDto = {
  id: string;
  sessionId?: string;
  status: string;
  inputText: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type AgentRunToolExecutionDto = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: string;
  requiresConfirmation?: boolean;
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt?: number;
};

export type AgentRunDetailDto = AgentRunListItemDto & {
  status: RunStatus;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: number;
  }>;
  executedToolCalls: AgentRunToolExecutionDto[];
  pendingToolCalls: AgentRunToolExecutionDto[];
  requiresConfirmation: boolean;
  finalText: string;
  error?: string;
  iterationCount: number;
  assistantTextChunks: string[];
  timeline: AgentState['timeline'];
};

export function toAgentRunDto(run: AgentRun): AgentRunListItemDto {
  return {
    id: run.id,
    sessionId: run.sessionId ?? undefined,
    status: run.status,
    inputText: run.inputText,
    model: run.model,
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
    version: run.version,
  };
}

export function buildAgentRunDetailDto(run: AgentRun, state: AgentState): AgentRunDetailDto {
  const base = toAgentRunDto(run);

  const executedToolCalls: AgentRunToolExecutionDto[] = state.executedToolCalls.map((tool) => ({
    id: tool.id,
    toolName: tool.name,
    arguments: tool.arguments,
    status: tool.status ?? (tool.success ? 'completed' : 'failed'),
    result: tool.result && typeof tool.result === 'object'
      ? (tool.result as Record<string, unknown>)
      : tool.result !== undefined
        ? { value: tool.result }
        : undefined,
    errorMessage: tool.error,
    createdAt: tool.createdAt,
  }));

  const pendingToolCalls: AgentRunToolExecutionDto[] = (state.pendingToolCalls ?? []).map((tool) => {
    const pending = state.pendingToolExecution && state.pendingToolExecution.id === tool.id
      ? state.pendingToolExecution
      : null;

    return {
      id: tool.id,
      toolName: tool.name,
      arguments: tool.arguments,
      status: pending ? 'waiting_confirmation' : 'pending',
      requiresConfirmation: Boolean(pending),
      result: pending ? { confirmationMessage: pending.confirmationMessage } : undefined,
    };
  });

  return {
    ...base,
    status: state.status,
    messages: state.messages.map((message, index) => ({
      id: `${state.runId}-msg-${index}`,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
    executedToolCalls,
    pendingToolCalls,
    requiresConfirmation: state.status === 'waiting_confirmation',
    finalText: state.finalText,
    error: state.error ?? undefined,
    iterationCount: state.iterationCount,
    assistantTextChunks: state.assistantTextChunks,
    timeline: state.timeline,
  };
}
