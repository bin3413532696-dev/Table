import { Annotation } from '@langchain/langgraph';

/**
 * Agent 状态定义
 * 使用 LangGraph Annotation 定义状态结构和 reducer
 */

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
};

export type PendingToolExecution = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  confirmationMessage: string;
};

export const AgentStateAnnotation = Annotation.Root({
  // 输入
  inputText: Annotation<string>,
  initialMessages: Annotation<Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }>>,

  // Provider 配置
  provider: Annotation<ProviderConfig>,
  model: Annotation<string>,
  systemPrompt: Annotation<string>,

  // 消息序列（使用默认 reducer，每次覆盖）
  messages: Annotation<ConversationMessage[]>,

  // 工具执行状态
  executedToolCalls: Annotation<ExecutedToolCall[]>({
    default: () => [],
    reducer: (_, y) => y ?? [],
  }),

  // 待执行工具（使用默认 reducer）
  pendingToolCalls: Annotation<ToolCall[]>,

  // 用户确认相关
  requiresConfirmation: Annotation<boolean>,
  pendingToolExecution: Annotation<PendingToolExecution | null>,
  confirmedToolCall: Annotation<ToolCall | null>,

  // 输出
  finalText: Annotation<string>,

  // 元数据
  runId: Annotation<string>,
  userId: Annotation<string>,
  iterationCount: Annotation<number>,
  status: Annotation<RunStatus>,
  error: Annotation<string | null>,

  // 流式控制
  assistantTextChunks: Annotation<string[]>({
    default: () => [],
    reducer: (_, y) => y,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

/**
 * 最大迭代次数
 */
export const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;

/**
 * 工具缓存 TTL（毫秒）
 */
export const CACHE_TTL_MS = 5000;