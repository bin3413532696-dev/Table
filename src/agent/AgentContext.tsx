import React, { createContext, useContext, useReducer, useCallback, useMemo, useEffect } from 'react';
import { AgentState, AgentMessage, ConfirmationRequest, ToolResult, ToolCall } from './types';
import { agentEngine } from './AgentEngine';
import { ollamaClient } from '../lib/ollama';

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
  | { type: 'ADD_TOOL_RESULT'; payload: { toolCallId: string; result: ToolResult } };

const initialState: AgentState = {
  messages: [],
  isProcessing: false,
  isConnected: false,
  selectedModel: 'llama3.2',
  availableModels: [],
  confirmationRequest: null,
  error: null,
};

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.payload.id ? { ...m, ...action.payload.updates } : m
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
      // 将工具结果附加到对应的消息
      return {
        ...state,
        messages: state.messages.map(m =>
          m.toolCalls?.some(tc => tc.id === action.payload.toolCallId)
            ? { ...m, toolResult: action.payload.result }
            : m
        ),
      };
    default:
      return state;
  }
}

interface AgentContextType {
  state: AgentState;
  sendMessage: (content: string) => Promise<void>;
  confirmAction: (executeTool: () => Promise<ToolResult>) => Promise<void>;
  rejectAction: () => void;
  clearConversation: () => void;
  checkConnection: () => Promise<void>;
  selectModel: (model: string) => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialState);

  // 初始化时检查连接
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = useCallback(async () => {
    const healthy = await ollamaClient.checkHealth();
    dispatch({ type: 'SET_CONNECTED', payload: healthy });
    if (healthy) {
      const models = await ollamaClient.listModels();
      dispatch({ type: 'SET_MODELS', payload: models });
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (state.isProcessing || !state.isConnected) return;

    // 添加用户消息
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

    // 创建助手消息占位
    const assistantMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };
    dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage });

    try {
      let fullContent = '';
      const pendingToolCalls: ToolCall[] = [];

      // 流式处理响应
      for await (const chunk of agentEngine.processMessage(
        state.messages.concat(userMessage),
        state.selectedModel
      )) {
        if (typeof chunk === 'string') {
          fullContent += chunk;
          dispatch({
            type: 'UPDATE_MESSAGE',
            payload: { id: assistantMessage.id, updates: { content: fullContent } },
          });
        } else if (chunk.type === 'tool_call') {
          pendingToolCalls.push(chunk.toolCall);
        }
      }

      // 处理工具调用
      if (pendingToolCalls.length > 0) {
        // 更新消息包含工具调用
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: {
            id: assistantMessage.id,
            updates: { content: fullContent, toolCalls: pendingToolCalls },
          },
        });

        // 执行工具调用
        for (const toolCall of pendingToolCalls) {
          const result = await agentEngine.executeTool(toolCall);

          if (result.requiresConfirmation) {
            // 需要用户确认，暂停处理
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
            dispatch({ type: 'SET_PROCESSING', payload: false });
            return;
          }

          // 直接执行成功，添加结果
          dispatch({
            type: 'ADD_TOOL_RESULT',
            payload: { toolCallId: toolCall.id, result },
          });
        }
      }

      // 清理工具调用标记
      const { textContent } = agentEngine.parseToolCalls(fullContent);
      if (textContent !== fullContent) {
        dispatch({
          type: 'UPDATE_MESSAGE',
          payload: { id: assistantMessage.id, updates: { content: textContent } },
        });
      }

      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: { id: assistantMessage.id, updates: { status: 'completed' } },
      });
    } catch (error) {
      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          id: assistantMessage.id,
          updates: { status: 'error', content: '处理请求时发生错误' },
        },
      });
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [state.messages, state.isProcessing, state.isConnected, state.selectedModel]);

  const confirmAction = useCallback(async (executeTool: () => Promise<ToolResult>) => {
    if (!state.confirmationRequest) return;

    dispatch({ type: 'SET_CONFIRMATION', payload: null });
    dispatch({ type: 'SET_PROCESSING', payload: true });

    try {
      const result = await executeTool();

      dispatch({
        type: 'ADD_TOOL_RESULT',
        payload: { toolCallId: state.confirmationRequest.id, result },
      });

      // 更新消息添加执行结果
      const successMsg = result.success
        ? `\n\n✅ 操作已执行成功`
        : `\n\n❌ 操作执行失败: ${result.error}`;

      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          id: state.confirmationRequest.pendingMessageId,
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
    if (!state.confirmationRequest) return;

    // 更新消息标记为取消
    dispatch({
      type: 'UPDATE_MESSAGE',
      payload: {
        id: state.confirmationRequest.pendingMessageId,
        updates: {
          content: state.messages.find(m => m.id === state.confirmationRequest?.pendingMessageId)?.content + '\n\n⚠️ 操作已取消',
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
    confirmAction,
    rejectAction,
    clearConversation,
    checkConnection,
    selectModel,
  }), [
    state,
    sendMessage,
    confirmAction,
    rejectAction,
    clearConversation,
    checkConnection,
    selectModel,
  ]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}