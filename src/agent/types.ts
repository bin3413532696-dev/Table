/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

/** JSON Schema 类型（简化版） */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: string[];
  items?: JSONSchema;
  description?: string;
  default?: unknown;
}

/** 工具定义接口 */
export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
  requiresConfirmation: boolean;
  category: 'query' | 'mutation' | 'system';
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 智能体消息状态 */
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error';

/** 智能体消息 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: Record<string, ToolResult>;
  status: MessageStatus;
}

/** 确认请求 */
export interface ConfirmationRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
  pendingMessageId: string;
}

/** 智能体状态 */
export interface AgentState {
  messages: AgentMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  selectedModel: string;
  availableModels: string[];
  confirmationRequest: ConfirmationRequest | null;
  error: string | null;
}

/** 对话历史管理常量 */
export const MAX_HISTORY_MESSAGES = 50; // 最大保留消息数量
export const MAX_CONTEXT_CHARS = 50000; // 最大上下文字符数（防止 token 超限）
