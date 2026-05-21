import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AgentMessage, AgentState, ConfirmationRequest, ToolCall, ToolResult, MAX_HISTORY_MESSAGES, MAX_CONTEXT_CHARS } from './types';
import { API_CONFIG_CHANGED_EVENT, getPreferredAgentModel } from '../lib/apiConfig';
import {
  type AgentRunDetailDto,
  type AgentSessionDetailDto,
  type AgentRunStreamEvent,
  fetchAgentRuntimeStatus,
  fetchAgentSessionList,
  fetchAgentSessionDetail,
  streamAgentRun,
  streamConfirmAgentToolExecution,
  streamRejectAgentToolExecution,
} from '../lib/agentApi';
import { MESSAGES } from '../core/messages';

type AgentAction =
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
  | { type: 'LOAD_HISTORY'; payload: { messages: AgentMessage[]; runId: string; sessionId: string | null } }
  | { type: 'UPDATE_SESSION_ID'; payload: string };

interface ActiveRequestState {
  controller: AbortController;
  assistantMessageId: string;
  content: string;
  canceled: boolean;
  stopHandled: boolean;
  toolCalls: ToolCall[];
  runId?: string;
}

const SESSION_ID_KEY = 'agent_session_id';

function getStoredSessionId(): string {
  if (typeof window === 'undefined') {
    return crypto.randomUUID();
  }
  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored) {
    return stored;
  }
  // 不在这里写入 localStorage，让 checkConnection 有机会加载服务端会话
  return crypto.randomUUID();
}

function storeSessionId(sessionId: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
}

function clearStoredSessionId() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_ID_KEY);
  }
}

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

const initialState: AgentState = {
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
};

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
    // 流式输出优化：追加streaming内容，不触发messages数组重建
    case 'APPEND_STREAMING_CONTENT':
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
    // 流式完成：将streaming内容合并到messages，清空streamingContent
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
    case 'CLEAR_MESSAGES':
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
        confirmationRequest: null,
      };
    case 'NEW_SESSION':
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
        confirmationRequest: null,
      };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'LOAD_HISTORY':
      const sessionId = action.payload.sessionId ?? getStoredSessionId();
      if (action.payload.sessionId) {
        storeSessionId(action.payload.sessionId);
      }
      return {
        ...state,
        messages: action.payload.messages,
        streamingContent: null,
        currentRunId: action.payload.runId,
        currentSessionId: sessionId,
        isProcessing: false,
        error: null,
        confirmationRequest: null,
      };
    case 'UPDATE_SESSION_ID':
      storeSessionId(action.payload);
      return { ...state, currentSessionId: action.payload };
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
  newSession: (sessionId?: string) => void;
  checkConnection: () => Promise<void>;
  selectModel: (model: string) => void;
  loadHistoryRun: (run: AgentRunDetailDto) => void;
  loadHistorySession: (session: AgentSessionDetailDto) => void;
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

      // 自动加载最近会话的历史消息（每次启动都同步）
      try {
        const sessionList = await fetchAgentSessionList({ limit: 1 });
        if (sessionList.items.length > 0) {
          const latestSession = sessionList.items[0];
          const detail = await fetchAgentSessionDetail(latestSession.id);
          if (detail.messages && detail.messages.length > 0) {
            // 过滤掉系统消息，不显示给用户
            const messages: AgentMessage[] = detail.messages
              .filter((msg) => msg.role !== 'system')
              .map((msg, index) => ({
                id: msg.id || `msg-${index}`,
                role: msg.role,
                content: msg.content,
                timestamp: msg.createdAt || Date.now(),
                status: 'completed' as const,
              }));
            dispatch({
              type: 'LOAD_HISTORY',
              payload: {
                messages,
                runId: detail.runs[detail.runs.length - 1]?.id ?? '',
                sessionId: detail.id,
              },
            });
          } else {
            // 没有消息，只同步 sessionId
            storeSessionId(latestSession.id);
            dispatch({ type: 'UPDATE_SESSION_ID', payload: latestSession.id });
          }
        }
      } catch {
        // 加载历史失败不影响主流程
      }
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
    // 新的 Checkpoint 格式: messages 没有 sequence，按顺序排列
    // 提取最后一条 assistant 消息
    const assistantReplies = run.messages.filter((message) => message.role === 'assistant');
    const assistantReply = assistantReplies[assistantReplies.length - 1];

    // 新的 Checkpoint 格式: executedToolCalls 而不是 toolExecutions
    const toolCalls: ToolCall[] = [
      ...(run.executedToolCalls || []),
      ...(run.pendingToolCalls || []),
    ].map((execution) => ({
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
            (run.executedToolCalls || [])
              .filter((execution) => execution.status === 'completed' || execution.status === 'failed')
              .map((execution) => [
                execution.id,
                {
                  success: execution.status === 'completed',
                  data: execution.result?.data ?? execution.result,
                  error: execution.errorMessage,
                } satisfies ToolResult,
              ])
          ),
          status: run.status === 'failed' ? 'error' : 'completed',
        },
      },
    });

    // 新的 Checkpoint 格式: pendingToolCalls 包含待确认的工具
    const pendingExecution = (run.pendingToolCalls || []).find((execution) => execution.status === 'waiting_confirmation');
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
      payload: run.error || null,
    });
  }, []);

  const applyStreamEventToAssistantMessage = useCallback((
    assistantMessageId: string,
    event: AgentRunStreamEvent,
    requestState?: ActiveRequestState
  ) => {
    if (event.type === 'metadata') {
      if (requestState && event.runId) {
        requestState.runId = event.runId;
      }
      return;
    }

    if (event.type === 'run_update') {
      if (event.run && event.run.status === 'waiting_confirmation') {
        // 等待确认时，将streaming内容合并到messages
        if (requestState) {
          dispatch({
            type: 'FINALIZE_STREAMING',
            payload: {
              messageId: assistantMessageId,
              finalContent: requestState.content,
              updates: {},
            },
          });
        }
        applyRunResultToAssistantMessage(assistantMessageId, event.run);
      }
      return;
    }

    if (event.type === 'run_completed') {
      if (event.run) {
        // 流式完成，将streaming内容合并到messages
        if (requestState) {
          dispatch({
            type: 'FINALIZE_STREAMING',
            payload: {
              messageId: assistantMessageId,
              finalContent: requestState.content,
              updates: {},
            },
          });
        }
        applyRunResultToAssistantMessage(assistantMessageId, event.run);
      }
      return;
    }

    // 处理新的 token 事件：直接发送token级内容
    if (event.type === 'token' && event.token) {
      const token = event.token;

      if (requestState) {
        requestState.content += token;
      }

      // 流式输出优化：使用 APPEND_STREAMING_CONTENT 避免高频 messages 数组重建
      dispatch({
        type: 'APPEND_STREAMING_CONTENT',
        payload: {
          messageId: assistantMessageId,
          chunk: token,
        },
      });
      return;
    }

    if (event.type === 'langgraph_chunk' && event.mode === 'messages' && Array.isArray(event.chunk)) {
      // LangGraph messages chunk 格式: [metadata, AIMessageChunk]
      // AIMessageChunk 是 LangChain 的消息类型，包含 content 字段
      const messageTuple = event.chunk as [Record<string, unknown>, { content?: string | Array<{ text?: string } | string> }?];
      // 第二个元素是 AIMessageChunk
      const messageChunk = messageTuple[1];
      const content = messageChunk?.content;

      let textChunk = '';
      if (typeof content === 'string') {
        textChunk = content;
      } else if (Array.isArray(content)) {
        textChunk = content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
              return part.text;
            }
            return '';
          })
          .join('');
      }

      if (!textChunk) {
        return;
      }

      if (requestState) {
        requestState.content += textChunk;
      }

      // 流式输出优化：使用 APPEND_STREAMING_CONTENT 避免高频 messages 数组重建
      dispatch({
        type: 'APPEND_STREAMING_CONTENT',
        payload: {
          messageId: assistantMessageId,
          chunk: textChunk,
        },
      });
    }
  }, [applyRunResultToAssistantMessage]);

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

  // 多标签页同步：监听其他标签页对 sessionId 的更新
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_ID_KEY && e.newValue && e.newValue !== state.currentSessionId) {
        dispatch({ type: 'UPDATE_SESSION_ID', payload: e.newValue });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [state.currentSessionId]);

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

    // 添加空的助手消息作为占位符
    dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage });

    // 初始化 streamingContent
    dispatch({
      type: 'APPEND_STREAMING_CONTENT',
      payload: { messageId: assistantMessage.id, chunk: '' },
    });

    const requestState: ActiveRequestState = {
      controller: new AbortController(),
      assistantMessageId: assistantMessage.id,
      content: '',
      canceled: false,
      stopHandled: false,
      toolCalls: [],
    };
    activeRequestRef.current = requestState;

    try {
      // 验证 sessionId 是否是有效 UUID，如果不是则不传（后端会自动创建）
      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.currentSessionId);
      const requestBody: {
        inputText: string;
        model: string;
        sessionId?: string;
      } = {
        inputText: content,
        model: state.selectedModel || 'default',
      };
      if (isValidUuid) {
        requestBody.sessionId = state.currentSessionId;
      }

      const run = await streamAgentRun(requestBody, {
        onEvent: (event) => {
          // 处理 metadata 中的 sessionId，确保前后端一致
          if (event.type === 'metadata' && event.sessionId) {
            dispatch({ type: 'UPDATE_SESSION_ID', payload: event.sessionId });
          }
          applyStreamEventToAssistantMessage(assistantMessage.id, event, requestState);
        },
      }, requestState.controller.signal);

      requestState.toolCalls = [
        ...(run.executedToolCalls || []),
        ...(run.pendingToolCalls || []),
      ].map((execution) => ({
        id: execution.id,
        name: execution.toolName,
        arguments: execution.arguments,
      }));

      // 流式完成，将最终内容合并到messages
      dispatch({
        type: 'FINALIZE_STREAMING',
        payload: {
          messageId: assistantMessage.id,
          finalContent: requestState.content,
          updates: { status: 'completed' },
        },
      });
      applyRunResultToAssistantMessage(assistantMessage.id, run);
    } catch (error) {
      if (requestState.canceled || requestState.controller.signal.aborted) {
        if (!requestState.stopHandled && activeRequestRef.current === requestState) {
          dispatch({
            type: 'FINALIZE_STREAMING',
            payload: {
              messageId: assistantMessage.id,
              finalContent: appendManualStopMessage(requestState.content),
              updates: { status: 'completed' },
            },
          });
          dispatch({ type: 'SET_ERROR', payload: null });
        }
        return;
      }

      dispatch({
        type: 'FINALIZE_STREAMING',
        payload: {
          messageId: assistantMessage.id,
          finalContent: MESSAGES.agent.processError,
          updates: { status: 'error' },
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
  }, [applyRunResultToAssistantMessage, state.currentSessionId, state.isConnected, state.isProcessing, state.selectedModel]);

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
      const controller = new AbortController();
      const run = await streamConfirmAgentToolExecution({
        runId: confirmationRequest.runId,
        toolExecutionId: confirmationRequest.id,
      }, {
        onEvent: (event) => {
          applyStreamEventToAssistantMessage(confirmationRequest.pendingMessageId, event);
        },
      }, controller.signal);
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
      const controller = new AbortController();
      const run = await streamRejectAgentToolExecution({
        runId: confirmationRequest.runId,
        toolExecutionId: confirmationRequest.id,
      }, {
        onEvent: (event) => {
          applyStreamEventToAssistantMessage(confirmationRequest.pendingMessageId, event);
        },
      }, controller.signal);
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

  const newSession = useCallback((sessionId?: string) => {
    dispatch({ type: 'NEW_SESSION', payload: sessionId });
  }, []);

  const selectModel = useCallback((model: string) => {
    dispatch({ type: 'SELECT_MODEL', payload: model });
  }, []);

  const loadHistoryRun = useCallback((run: AgentRunDetailDto) => {
    // 过滤掉系统消息，不显示给用户
    const messages: AgentMessage[] = run.messages
      .filter((msg) => msg.role !== 'system')
      .map((msg, index) => ({
        id: msg.id || `msg-${index}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt || Date.now(),
        status: 'completed' as const,
      }));

    dispatch({
      type: 'LOAD_HISTORY',
      payload: { messages, runId: run.id, sessionId: run.sessionId ?? null },
    });
  }, []);

  const loadHistorySession = useCallback((session: AgentSessionDetailDto) => {
    // 优先使用 checkpoint 中的完整消息
    const messages: AgentMessage[] = [];

    if (session.messages && session.messages.length > 0) {
      // 从 checkpoint 加载的完整对话历史（过滤掉系统消息）
      for (const msg of session.messages) {
        // 过滤掉系统消息，不显示给用户
        if (msg.role === 'system') continue;
        messages.push({
          id: msg.id || `msg-${messages.length}`,
          role: msg.role,
          content: msg.content,
          timestamp: msg.createdAt || Date.now(),
          status: 'completed' as const,
        });
      }
    } else {
      // 降级：从 run 列表构建消息
      for (const run of session.runs) {
        messages.push({
          id: `user-${run.id}`,
          role: 'user',
          content: run.inputText,
          timestamp: run.createdAt,
          status: 'completed' as const,
        });
        messages.push({
          id: `assistant-${run.id}`,
          role: 'assistant',
          content: run.status === 'completed' ? '（回复内容不可用）' : `状态: ${run.status}`,
          timestamp: run.createdAt + 1,
          status: run.status === 'failed' ? 'error' as const : 'completed' as const,
        });
      }
    }

    dispatch({
      type: 'LOAD_HISTORY',
      payload: { messages, runId: session.runs[session.runs.length - 1]?.id ?? '', sessionId: session.id },
    });
  }, []);

  const value = useMemo(() => ({
    state,
    sendMessage,
    stopThinking,
    confirmAction,
    rejectAction,
    clearConversation,
    newSession,
    checkConnection,
    selectModel,
    loadHistoryRun,
    loadHistorySession,
  }), [state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, newSession, checkConnection, selectModel, loadHistoryRun, loadHistorySession]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}
