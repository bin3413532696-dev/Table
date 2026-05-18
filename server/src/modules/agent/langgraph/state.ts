import { Annotation } from '@langchain/langgraph';

export type RunStatus = 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';

export type ProviderConfig = {
  id: string;
  name: string;
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey: string;
  model?: string;
  headers?: Record<string, string>;
};

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt?: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ExecutedToolCall = ToolCall & {
  result: unknown;
  success: boolean;
  error?: string;
  status?: 'completed' | 'failed' | 'waiting_confirmation';
  createdAt?: number;
};

export type PendingToolExecution = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  confirmationMessage: string;
};

export type TimelineEvent = {
  type: 'llm_start' | 'llm_end' | 'tool_start' | 'tool_end' | 'confirmation' | 'interrupted';
  timestamp: string;
  data: Record<string, unknown>;
};

export const AgentStateAnnotation = Annotation.Root({
  inputText: Annotation<string>,
  initialMessages: Annotation<Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }>>,

  provider: Annotation<ProviderConfig>,
  model: Annotation<string>,
  systemPrompt: Annotation<string>,

  messages: Annotation<ConversationMessage[]>({
    default: () => [],
    reducer: (_, y) => y ?? [],
  }),

  executedToolCalls: Annotation<ExecutedToolCall[]>({
    default: () => [],
    reducer: (_, y) => y ?? [],
  }),

  pendingToolCalls: Annotation<ToolCall[]>({
    default: () => [],
    reducer: (_, y) => y ?? [],
  }),

  requiresConfirmation: Annotation<boolean>({
    default: () => false,
    reducer: (_, y) => y,
  }),
  pendingToolExecution: Annotation<PendingToolExecution | null>({
    default: () => null,
    reducer: (_, y) => y,
  }),
  confirmedToolCall: Annotation<ToolCall | null>({
    default: () => null,
    reducer: (_, y) => y,
  }),

  finalText: Annotation<string>({
    default: () => '',
    reducer: (_, y) => y,
  }),

  runId: Annotation<string>,
  userId: Annotation<string>,
  iterationCount: Annotation<number>({
    default: () => 0,
    reducer: (_, y) => y,
  }),
  status: Annotation<RunStatus>({
    default: () => 'running',
    reducer: (_, y) => y,
  }),
  error: Annotation<string | null>({
    default: () => null,
    reducer: (_, y) => y,
  }),

  assistantTextChunks: Annotation<string[]>({
    default: () => [],
    reducer: (_, y) => y ?? [],
  }),

  timeline: Annotation<TimelineEvent[]>({
    default: () => [],
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

export const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;
export const CACHE_TTL_MS = 5000;
