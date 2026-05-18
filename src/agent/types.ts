export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: string[];
  items?: JSONSchema;
  description?: string;
  default?: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
  requiresConfirmation: boolean;
  category: 'query' | 'mutation' | 'system';
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: Record<string, ToolResult>;
  status: MessageStatus;
}

export interface ConfirmationRequest {
  id: string;
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
  pendingMessageId: string;
}

export interface AgentState {
  messages: AgentMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  selectedModel: string;
  availableModels: string[];
  confirmationRequest: ConfirmationRequest | null;
  error: string | null;
  currentRunId: string | null;
}

export const MAX_HISTORY_MESSAGES = 50;
export const MAX_CONTEXT_CHARS = 50000;
