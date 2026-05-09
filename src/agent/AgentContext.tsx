import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AgentMessage, AgentState, ConfirmationRequest, ToolCall, ToolResult, MAX_HISTORY_MESSAGES, MAX_CONTEXT_CHARS } from './types';
import { API_CONFIG_CHANGED_EVENT, getPreferredAgentModel } from '../lib/apiConfig';
import {
  type AgentRunDetailDto,
  confirmAgentToolExecution,
  createAgentRun,
  fetchAgentRuntimeStatus,
  rejectAgentToolExecution,
} from '../lib/agentApi';
import { MESSAGES } from '../core/messages';

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
  | { type: 'LOAD_HISTORY'; payload: { messages: AgentMessage[]; runId: string } };

interface ActiveRequestState {
  controller: AbortController;
  assistantMessageId: string;
  content: string;
  canceled: boolean;
  stopHandled: boolean;
  toolCalls: ToolCall[];
}

const initialState: AgentState = {
  messages: [],
  isProcessing: false,
  isConnected: false,
  selectedModel: getPreferredAgentModel(),
  availableModels: [],
  confirmationRequest: null,
  error: null,
  currentRunId: null,
};

/**
 * 对话历史管理：裁剪消息以符合限制
 * 保留最近的消息，确保不超过最大数量和字符限制
 */
function trimMessagesHistory(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  // 首先按数量裁剪，保留最近的消息
  let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

  // 然后按字符数裁剪：找到合适的起始索引，一次性截取
  let totalChars = trimmed.reduce((sum, msg) => sum + msg.content.length, 0);

  if (totalChars <= MAX_CONTEXT_CHARS) {
    return trimmed;
  }

  let cutIndex = 0;
  while (cutIndex < trimmed.length - 1 && totalChars > MAX_CONTEXT_CHARS) {
    totalChars -= trimmed[cutIndex].content.length;
    cutIndex++;
  }

  return trimmed.slice(cutIndex);
}

function appendManualStopMessage(content: string): string {
  const stopMessage = '已手动终止本次思考。';
  if (!content.trim()) {
    return stopMessage;
  }

  return content.includes(stopMessage) ? content : `${content}\n\n${stopMessage}`;
}
function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      // 添加消息后自动裁剪历史
      const newMessages = [...state.messages, action.payload];
      return { ...state, messages: trimMessagesHistory(newMessages) };
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
    case 'LOAD_HISTORY':
      return {
        ...state,
        messages: action.payload.messages,
        currentRunId: action.payload.runId,
        isProcessing: false,
        error: null,
        confirmationRequest: null,
      };
    default:
      return state;
  }
}

interface AgentContextType {
  state: AgentState;
  sendMessage: (content: string) => Promise<void>;
  stopThinking: () => void;
  confirmAction: () => Promise<void>;
  rejectAction: () => Promise<void>;
  clearConversation: () => void;
  checkConnection: () => Promise<void>;
  selectModel: (model: string) => void;
  loadHistoryRun: (run: AgentRunDetailDto) => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialState);
  const activeRequestRef = useRef<ActiveRequestState | null>(null);

  const handleRuntimeUnavailable = useCallback((error: unknown) => {
    dispatch({ type: 'SET_CONNECTED', payload: false });
    dispatch({ type: 'SET_MODELS', payload: [] });
    dispatch({ type: 'SELECT_MODEL', payload: getPreferredAgentModel() });
    dispatch({
      type: 'SET_ERROR',
      payload: error instanceof Error ? error.message : 'Agent runtime unavailable',
    });
  }, []);

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
    try {
      const runtime = await fetchAgentRuntimeStatus();
      dispatch({ type: 'SET_CONNECTED', payload: runtime.runtime.connected });
      dispatch({ type: 'SET_MODELS', payload: runtime.runtime.availableModels });

      const preferredModel = runtime.runtime.selectedModel || getPreferredAgentModel();
      dispatch({
        type: 'SELECT_MODEL',
        payload: runtime.runtime.availableModels.includes(preferredModel)
          ? preferredModel
          : (runtime.runtime.availableModels[0] || preferredModel),
      });
      dispatch({ type: 'SET_ERROR', payload: null });
    } catch (error) {
      handleRuntimeUnavailable(error);
    }
  }, [handleRuntimeUnavailable]);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const applyRunResultToAssistantMessage = useCallback((
    assistantMessageId: string,
    run: AgentRunDetailDto
  ) => {
    const assistantReply = run.messages
      .filter((message) => message.role === 'assistant')
      .sort((a, b) => a.sequence - b.sequence)
      .at(-1);

    const toolCalls: ToolCall[] = run.toolExecutions.map((execution) => ({
      id: execution.id,
      name: execution.toolName,
      arguments: execution.arguments,
    }));

    dispatch({
      type: 'UPDATE_MESSAGE',
      payload: {
        id: assistantMessageId,
        updates: {
          content: assistantReply?.content || '',
          toolCalls,
          toolResults: Object.fromEntries(
            run.toolExecutions
              .filter((execution) => execution.status === 'completed' || execution.status === 'failed')
              .map((execution) => [
                execution.id,
                {
                  success: execution.status === 'completed',
                  data: execution.result?.data,
                  error: execution.errorMessage,
                } satisfies ToolResult,
              ])
          ),
          status: run.status === 'failed' ? 'error' : 'completed',
        },
      },
    });

    const pendingExecution = run.toolExecutions.find((execution) => execution.status === 'waiting_confirmation');
    if (run.status === 'waiting_confirmation' && pendingExecution) {
      const confirmationMessage = typeof pendingExecution.result?.confirmationMessage === 'string'
        ? pendingExecution.result.confirmationMessage
        : `即将执行 ${pendingExecution.toolName}，请确认。`;

      dispatch({
        type: 'SET_CONFIRMATION',
        payload: {
          id: pendingExecution.id,
          runId: run.id,
          toolName: pendingExecution.toolName,
          arguments: pendingExecution.arguments,
          description: confirmationMessage,
          pendingMessageId: assistantMessageId,
        },
      });
    } else {
      dispatch({ type: 'SET_CONFIRMATION', payload: null });
    }

    dispatch({
      type: 'SET_ERROR',
      payload: run.errorMessage || null,
    });
  }, []);

  useEffect(() => {
    const handleConfigChanged = () => {
      dispatch({ type: 'SELECT_MODEL', payload: getPreferredAgentModel() });
      void checkConnection();
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
      toolCalls: [],
    };
    activeRequestRef.current = requestState;

    const updateAssistantMessage = (updates: Partial<AgentMessage>) => {
      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: { id: assistantMessage.id, updates },
      });
    };

    try {
      const run = await createAgentRun({
        inputText: content,
        model: state.selectedModel,
        initialMessages: state.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      requestState.toolCalls = run.toolExecutions.map((execution) => ({
        id: execution.id,
        name: execution.toolName,
        arguments: execution.arguments,
      }));

      updateAssistantMessage({ status: 'completed' });
      applyRunResultToAssistantMessage(assistantMessage.id, run);
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
          updates: { status: 'error', content: MESSAGES.agent.processError },
        },
      });
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : MESSAGES.common.unknownError,
      });
    } finally {
      if (activeRequestRef.current === requestState) {
        activeRequestRef.current = null;
        dispatch({ type: 'SET_PROCESSING', payload: false });
      }
    }
  }, [applyRunResultToAssistantMessage, state.isConnected, state.isProcessing, state.messages, state.selectedModel]);

  const stopThinking = useCallback(() => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) {
      return;
    }

    handleManualStop(activeRequest);
  }, [handleManualStop]);

  const confirmAction = useCallback(async () => {
    const confirmationRequest = state.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    dispatch({ type: 'SET_CONFIRMATION', payload: null });
    dispatch({ type: 'SET_PROCESSING', payload: true });

    try {
      const run = await confirmAgentToolExecution({
        runId: confirmationRequest.runId,
        toolExecutionId: confirmationRequest.id,
      });
      applyRunResultToAssistantMessage(confirmationRequest.pendingMessageId, run);
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : MESSAGES.agent.executeFailed,
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [applyRunResultToAssistantMessage, state.confirmationRequest]);

  const rejectAction = useCallback(async () => {
    const confirmationRequest = state.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    dispatch({ type: 'SET_CONFIRMATION', payload: null });
    dispatch({ type: 'SET_PROCESSING', payload: true });

    try {
      const run = await rejectAgentToolExecution({
        runId: confirmationRequest.runId,
        toolExecutionId: confirmationRequest.id,
      });
      applyRunResultToAssistantMessage(confirmationRequest.pendingMessageId, run);
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : MESSAGES.agent.cancelFailed,
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [applyRunResultToAssistantMessage, state.confirmationRequest]);

  const clearConversation = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const selectModel = useCallback((model: string) => {
    dispatch({ type: 'SELECT_MODEL', payload: model });
  }, []);

  const loadHistoryRun = useCallback((run: AgentRunDetailDto) => {
    const messages: AgentMessage[] = run.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.createdAt,
      status: 'completed' as const,
    }));

    dispatch({
      type: 'LOAD_HISTORY',
      payload: { messages, runId: run.id },
    });
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
    loadHistoryRun,
  }), [state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, checkConnection, selectModel, loadHistoryRun]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}
