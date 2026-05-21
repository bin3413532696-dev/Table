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

const arrayAppendReducer = <T>() => (x: T[] | undefined, y: T[] | undefined): T[] =>
  [...(x ?? []), ...(y ?? [])];

const scalarReplaceReducer = <T>() => (_: T, y: T): T => y;

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
    reducer: arrayAppendReducer(),
  }),

  modelInputMessages: Annotation<ConversationMessage[]>({
    default: () => [],
    reducer: scalarReplaceReducer(),
  }),

  executedToolCalls: Annotation<ExecutedToolCall[]>({
    default: () => [],
    reducer: arrayAppendReducer(),
  }),

  pendingToolCalls: Annotation<ToolCall[]>({
    default: () => [],
    reducer: scalarReplaceReducer(),
  }),

  requiresConfirmation: Annotation<boolean>({
    default: () => false,
    reducer: scalarReplaceReducer(),
  }),
  pendingToolExecution: Annotation<PendingToolExecution | null>({
    default: () => null,
    reducer: scalarReplaceReducer(),
  }),
  confirmedToolCall: Annotation<ToolCall | null>({
    default: () => null,
    reducer: scalarReplaceReducer(),
  }),

  finalText: Annotation<string>({
    default: () => '',
    reducer: scalarReplaceReducer(),
  }),

  runId: Annotation<string>,
  userId: Annotation<string>,
  iterationCount: Annotation<number>({
    default: () => 0,
    reducer: scalarReplaceReducer(),
  }),
  inputAppended: Annotation<boolean>({
    default: () => false,
    reducer: scalarReplaceReducer(),
  }),
  status: Annotation<RunStatus>({
    default: () => 'running',
    reducer: scalarReplaceReducer(),
  }),
  error: Annotation<string | null>({
    default: () => null,
    reducer: scalarReplaceReducer(),
  }),

  assistantTextChunks: Annotation<string[]>({
    default: () => [],
    reducer: arrayAppendReducer(),
  }),

  timeline: Annotation<TimelineEvent[]>({
    default: () => [],
    reducer: arrayAppendReducer(),
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

export const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;
export const CACHE_TTL_MS = 5000;
