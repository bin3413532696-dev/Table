import type { AgentSessionMemoryDto } from '../lib/agentApi';
import { getPreferredAgentModel } from '../lib/apiConfig';
import type { AgentMessage, AgentState, ConfirmationRequest, ToolCall } from './types';
import { trimMessagesHistory } from './messageUtils';
import {
  clearStoredSessionId,
  getStoredRagEnabled,
  getStoredSessionId,
  storeRagEnabled,
  storeSessionId,
} from './storage';

export type AgentAction =
  | { type: 'ADD_MESSAGE'; payload: AgentMessage }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; updates: Partial<AgentMessage> } }
  | { type: 'APPEND_STREAMING_CONTENT'; payload: { messageId: string; chunk: string } }
  | { type: 'FINALIZE_STREAMING'; payload: { messageId: string; finalContent: string; updates: Partial<AgentMessage> } }
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_MODELS'; payload: string[] }
  | { type: 'SELECT_MODEL'; payload: string }
  | { type: 'SET_CONFIRMATION'; payload: ConfirmationRequest | null }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_SESSION'; payload?: string }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'LOAD_HISTORY'; payload: { messages: AgentMessage[]; runId: string; sessionId: string | null; memory?: AgentSessionMemoryDto | null } }
  | { type: 'UPDATE_SESSION_ID'; payload: string }
  | { type: 'SET_SESSION_MEMORY'; payload: AgentSessionMemoryDto | null }
  | { type: 'SET_RAG_ENABLED'; payload: boolean }
  | { type: 'SET_MESSAGE_TOOL_CALLS'; payload: { id: string; toolCalls: ToolCall[] } };

export function createInitialAgentState(): AgentState {
  return {
    messages: [],
    streamingContent: null,
    isProcessing: false,
    isConnected: false,
    selectedModel: getPreferredAgentModel(),
    availableModels: [],
    confirmationRequest: null,
    error: null,
    currentRunId: null,
    currentSessionId: getStoredSessionId(),
    currentSessionMemory: null,
    ragEnabled: getStoredRagEnabled(),
  };
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'ADD_MESSAGE': {
      const newMessages = [...state.messages, action.payload];
      return { ...state, messages: trimMessagesHistory(newMessages) };
    }
    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.payload.id ? { ...message, ...action.payload.updates } : message
        ),
      };
    case 'APPEND_STREAMING_CONTENT': {
      const current = state.streamingContent;
      return {
        ...state,
        streamingContent: {
          messageId: action.payload.messageId,
          content: current?.messageId === action.payload.messageId
            ? current.content + action.payload.chunk
            : action.payload.chunk,
          status: 'streaming',
        },
      };
    }
    case 'FINALIZE_STREAMING':
      return {
        ...state,
        streamingContent: null,
        messages: state.messages.map((message) =>
          message.id === action.payload.messageId
            ? { ...message, content: action.payload.finalContent, ...action.payload.updates }
            : message
        ),
      };
    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.payload };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.payload };
    case 'SET_MODELS':
      return { ...state, availableModels: action.payload };
    case 'SELECT_MODEL':
      return { ...state, selectedModel: action.payload };
    case 'SET_CONFIRMATION':
      return { ...state, confirmationRequest: action.payload };
    case 'CLEAR_MESSAGES': {
      const clearSessionId = crypto.randomUUID();
      clearStoredSessionId();
      storeSessionId(clearSessionId);
      return {
        ...state,
        messages: [],
        streamingContent: null,
        error: null,
        currentRunId: null,
        currentSessionId: clearSessionId,
        currentSessionMemory: null,
        confirmationRequest: null,
      };
    }
    case 'NEW_SESSION': {
      const newSessionId = action.payload || crypto.randomUUID();
      clearStoredSessionId();
      storeSessionId(newSessionId);
      return {
        ...state,
        messages: [],
        streamingContent: null,
        error: null,
        currentRunId: null,
        currentSessionId: newSessionId,
        currentSessionMemory: null,
        confirmationRequest: null,
      };
    }
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'LOAD_HISTORY': {
      const sessionId = action.payload.sessionId ?? getStoredSessionId();
      if (action.payload.sessionId) {
        storeSessionId(action.payload.sessionId);
      }

      const nextMemory = action.payload.memory !== undefined
        ? action.payload.memory
        : (sessionId === state.currentSessionId ? state.currentSessionMemory : null);

      return {
        ...state,
        messages: action.payload.messages,
        streamingContent: null,
        currentRunId: action.payload.runId,
        currentSessionId: sessionId,
        currentSessionMemory: nextMemory,
        isProcessing: false,
        error: null,
        confirmationRequest: null,
      };
    }
    case 'UPDATE_SESSION_ID':
      storeSessionId(action.payload);
      return {
        ...state,
        currentSessionId: action.payload,
        currentSessionMemory: action.payload === state.currentSessionId ? state.currentSessionMemory : null,
      };
    case 'SET_SESSION_MEMORY':
      return { ...state, currentSessionMemory: action.payload };
    case 'SET_RAG_ENABLED':
      storeRagEnabled(action.payload);
      return { ...state, ragEnabled: action.payload };
    case 'SET_MESSAGE_TOOL_CALLS':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.payload.id ? { ...message, toolCalls: action.payload.toolCalls } : message
        ),
      };
    default:
      return state;
  }
}
