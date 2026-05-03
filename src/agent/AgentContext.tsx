import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { agentEngine } from './AgentEngine';
import { AgentMessage, AgentState, ConfirmationRequest, ToolCall, ToolResult } from './types';
import { ollamaClient } from '../lib/ollama';
import { API_CONFIG_CHANGED_EVENT, ensureBootstrappedApiConfig, getPreferredAgentModel } from '../lib/apiConfig';

type AgentAction =
  | { type: 'ADD_MESSAGE'; payload: AgentMessage }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; updates: Partial<AgentMessage> } }
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_MODELS'; payload: string[] }
  | { type: 'SELECT_MODEL'; payload: string }
  | { type: 'SET_CONFIRMATION'; payload: ConfirmationRequest | null }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'ADD_TOOL_RESULT'; payload: { toolCallId: string; result: ToolResult; summary: string } };

interface ActiveRequestState {
  controller: AbortController;
  assistantMessageId: string;
  content: string;
  canceled: boolean;
  stopHandled: boolean;
}

const initialState: AgentState = {
  messages: [],
  isProcessing: false,
  isConnected: false,
  selectedModel: getPreferredAgentModel(),
  availableModels: [],
  confirmationRequest: null,
  error: null,
};

function appendToolSummary(content: string, summary: string): string {
  if (!summary.trim()) {
    return content;
  }

  return content ? `${content}\n\n${summary}` : summary;
}

function appendManualStopMessage(content: string): string {
  const stopMessage = '已手动终止本次思考。';
  if (!content.trim()) {
    return stopMessage;
  }

  return content.includes(stopMessage) ? content : `${content}\n\n${stopMessage}`;
}

function formatToolResultSummary(result: ToolResult, toolName: string): string {
  if (result.requiresConfirmation) {
    return result.confirmationMessage || `工具 ${toolName} 等待确认执行。`;
  }

  if (!result.success) {
    return `工具 ${toolName} 执行失败：${result.error || '未知错误'}`;
  }

  if (result.data === undefined) {
    return `工具 ${toolName} 已执行成功。`;
  }

  try {
    return `工具 ${toolName} 执行结果：\n${JSON.stringify(result.data, null, 2)}`;
  } catch {
    return `工具 ${toolName} 已执行成功。`;
  }
}

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.payload.id ? { ...message, ...action.payload.updates } : message
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
    case 'CLEAR_MESSAGES':
      return { ...state, messages: [], error: null };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'ADD_TOOL_RESULT':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.toolCalls?.some((toolCall) => toolCall.id === action.payload.toolCallId)
            ? {
                ...message,
                content: appendToolSummary(message.content, action.payload.summary),
                toolResult: action.payload.result,
              }
            : message
        ),
      };
    default:
      return state;
  }
}

interface AgentContextType {
  state: AgentState;
  sendMessage: (content: string) => Promise<void>;
  stopThinking: () => void;
  confirmAction: (executeTool: () => Promise<ToolResult>) => Promise<void>;
  rejectAction: () => void;
  clearConversation: () => void;
  checkConnection: () => Promise<void>;
  selectModel: (model: string) => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialState);
  const activeRequestRef = useRef<ActiveRequestState | null>(null);

  const handleManualStop = useCallback((requestState: ActiveRequestState) => {
    if (requestState.stopHandled) {
      return;
    }

    requestState.canceled = true;
    requestState.stopHandled = true;
    requestState.controller.abort('user_stop');

    dispatch({
      type: 'UPDATE_MESSAGE',
      payload: {
        id: requestState.assistantMessageId,
        updates: {
          status: 'completed',
          content: appendManualStopMessage(requestState.content),
        },
      },
    });
    dispatch({ type: 'SET_ERROR', payload: null });

    if (activeRequestRef.current === requestState) {
      activeRequestRef.current = null;
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, []);

  const checkConnection = useCallback(async () => {
    const healthy = await ollamaClient.checkHealth();
    dispatch({ type: 'SET_CONNECTED', payload: healthy });

    if (!healthy) {
      dispatch({ type: 'SET_MODELS', payload: [] });
      return;
    }

    const models = await ollamaClient.listModels();
    dispatch({ type: 'SET_MODELS', payload: models });

    const preferredModel = getPreferredAgentModel();
    dispatch({
      type: 'SELECT_MODEL',
      payload: models.includes(preferredModel) ? preferredModel : (models[0] || preferredModel),
    });
  }, []);

  useEffect(() => {
    ensureBootstrappedApiConfig();
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    const handleConfigChanged = () => {
      dispatch({ type: 'SELECT_MODEL', payload: getPreferredAgentModel() });
      checkConnection();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(API_CONFIG_CHANGED_EVENT, handleConfigChanged);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(API_CONFIG_CHANGED_EVENT, handleConfigChanged);
      }
    };
  }, [checkConnection]);

  const sendMessage = useCallback(async (content: string) => {
    if (state.isProcessing || !state.isConnected) {
      return;
    }

    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'completed',
    };

    dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
    dispatch({ type: 'SET_PROCESSING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    const assistantMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };

    dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage });

    const requestState: ActiveRequestState = {
      controller: new AbortController(),
      assistantMessageId: assistantMessage.id,
      content: '',
      canceled: false,
      stopHandled: false,
    };
    activeRequestRef.current = requestState;

    const ensureRequestActive = () => {
      if (requestState.canceled || requestState.controller.signal.aborted || activeRequestRef.current !== requestState) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
    };

    try {
      const directToolCall = agentEngine.findDirectToolCall(content);
      const pendingToolCalls: ToolCall[] = [];

      for await (const chunk of agentEngine.processMessage(
        state.messages.concat(userMessage),
        state.selectedModel,
        requestState.controller.signal
      )) {
        ensureRequestActive();

        if (typeof chunk === 'string') {
          requestState.content += chunk;
          dispatch({
            type: 'UPDATE_MESSAGE',
            payload: { id: assistantMessage.id, updates: { content: requestState.content } },
          });
        } else if (chunk.type === 'tool_call') {
          pendingToolCalls.push(chunk.toolCall);
        }
      }

      ensureRequestActive();

      const { textContent } = agentEngine.parseToolCalls(requestState.content);
      const assistantBaseContent = textContent !== requestState.content ? textContent : requestState.content;
      requestState.content = assistantBaseContent;

      if (pendingToolCalls.length > 0) {
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: {
            id: assistantMessage.id,
            updates: { content: assistantBaseContent, toolCalls: pendingToolCalls },
          },
        });

        for (const toolCall of pendingToolCalls) {
          ensureRequestActive();
          const result = await agentEngine.executeTool(toolCall);
          ensureRequestActive();

          if (result.requiresConfirmation) {
            dispatch({
              type: 'SET_CONFIRMATION',
              payload: {
                id: toolCall.id,
                toolName: toolCall.name,
                arguments: toolCall.arguments,
                description: result.confirmationMessage || '',
                pendingMessageId: assistantMessage.id,
              },
            });

            if (activeRequestRef.current === requestState) {
              activeRequestRef.current = null;
              dispatch({ type: 'SET_PROCESSING', payload: false });
            }
            return;
          }

          dispatch({
            type: 'ADD_TOOL_RESULT',
            payload: {
              toolCallId: toolCall.id,
              result,
              summary: formatToolResultSummary(result, toolCall.name),
            },
          });
        }
      } else if (directToolCall) {
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: {
            id: assistantMessage.id,
            updates: { content: assistantBaseContent, toolCalls: [directToolCall] },
          },
        });

        ensureRequestActive();
        const result = await agentEngine.executeTool(directToolCall);
        ensureRequestActive();

        if (result.requiresConfirmation) {
          dispatch({
            type: 'SET_CONFIRMATION',
            payload: {
              id: directToolCall.id,
              toolName: directToolCall.name,
              arguments: directToolCall.arguments,
              description: result.confirmationMessage || '',
              pendingMessageId: assistantMessage.id,
            },
          });

          if (activeRequestRef.current === requestState) {
            activeRequestRef.current = null;
            dispatch({ type: 'SET_PROCESSING', payload: false });
          }
          return;
        }

        dispatch({
          type: 'ADD_TOOL_RESULT',
          payload: {
            toolCallId: directToolCall.id,
            result,
            summary: formatToolResultSummary(result, directToolCall.name),
          },
        });
      } else if (assistantBaseContent !== requestState.content) {
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: { id: assistantMessage.id, updates: { content: assistantBaseContent } },
        });
      }

      if (activeRequestRef.current === requestState) {
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: { id: assistantMessage.id, updates: { status: 'completed' } },
        });
      }
    } catch (error) {
      if (requestState.canceled || requestState.controller.signal.aborted) {
        if (!requestState.stopHandled && activeRequestRef.current === requestState) {
          dispatch({
            type: 'UPDATE_MESSAGE',
            payload: {
              id: assistantMessage.id,
              updates: {
                status: 'completed',
                content: appendManualStopMessage(requestState.content),
              },
            },
          });
          dispatch({ type: 'SET_ERROR', payload: null });
        }
        return;
      }

      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          id: assistantMessage.id,
          updates: { status: 'error', content: '处理请求时发生错误。' },
        },
      });
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      if (activeRequestRef.current === requestState) {
        activeRequestRef.current = null;
        dispatch({ type: 'SET_PROCESSING', payload: false });
      }
    }
  }, [state.isConnected, state.isProcessing, state.messages, state.selectedModel]);

  const stopThinking = useCallback(() => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) {
      return;
    }

    handleManualStop(activeRequest);
  }, [handleManualStop]);

  const confirmAction = useCallback(async (executeTool: () => Promise<ToolResult>) => {
    const confirmationRequest = state.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    dispatch({ type: 'SET_CONFIRMATION', payload: null });
    dispatch({ type: 'SET_PROCESSING', payload: true });

    try {
      const result = await executeTool();

      dispatch({
        type: 'ADD_TOOL_RESULT',
        payload: {
          toolCallId: confirmationRequest.id,
          result,
          summary: formatToolResultSummary(result, confirmationRequest.toolName),
        },
      });

      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          id: confirmationRequest.pendingMessageId,
          updates: { status: 'completed' },
        },
      });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : '执行失败',
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [state.confirmationRequest]);

  const rejectAction = useCallback(() => {
    const confirmationRequest = state.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    const pendingMessage = state.messages.find(
      (message) => message.id === confirmationRequest.pendingMessageId
    );

    dispatch({
      type: 'UPDATE_MESSAGE',
      payload: {
        id: confirmationRequest.pendingMessageId,
        updates: {
          content: `${pendingMessage?.content || ''}\n\n操作已取消。`,
          status: 'completed',
        },
      },
    });

    dispatch({ type: 'SET_CONFIRMATION', payload: null });
  }, [state.confirmationRequest, state.messages]);

  const clearConversation = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const selectModel = useCallback((model: string) => {
    dispatch({ type: 'SELECT_MODEL', payload: model });
  }, []);

  const value = useMemo(() => ({
    state,
    sendMessage,
    stopThinking,
    confirmAction,
    rejectAction,
    clearConversation,
    checkConnection,
    selectModel,
  }), [state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, checkConnection, selectModel]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}
