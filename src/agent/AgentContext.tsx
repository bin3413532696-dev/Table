import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { agentEngine } from './AgentEngine';
import { AgentMessage, AgentState, ConfirmationRequest, ToolCall, ToolResult, MAX_HISTORY_MESSAGES, MAX_CONTEXT_CHARS } from './types';
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
  committedContent: string;
  canceled: boolean;
  stopHandled: boolean;
  toolCalls: ToolCall[];
}

interface ToolExecutionRecord {
  toolCall: ToolCall;
  result: ToolResult;
}

interface PendingAgentContinuation {
  assistantMessageId: string;
  model: string;
  iteration: number;
  conversationMessages: AgentMessage[];
  assistantText: string;
  pendingToolCalls: ToolCall[];
  nextToolIndex: number;
  toolResults: ToolExecutionRecord[];
  renderedContent: string;
  accumulatedToolCalls: ToolCall[];
}

const MAX_AGENT_ITERATIONS = 5;

const initialState: AgentState = {
  messages: [],
  isProcessing: false,
  isConnected: false,
  selectedModel: getPreferredAgentModel(),
  availableModels: [],
  confirmationRequest: null,
  error: null,
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

  // 然后按字符数裁剪
  let totalChars = trimmed.reduce((sum, msg) => sum + msg.content.length, 0);

  while (totalChars > MAX_CONTEXT_CHARS && trimmed.length > 1) {
    // 移除最早的消息（但保留最后一条用户消息和所有最近的交互）
    const removed = trimmed.shift();
    if (removed) {
      totalChars -= removed.content.length;
    }
  }

  return trimmed;
}

function appendToolSummary(content: string, summary: string): string {
  if (!summary.trim()) {
    return content;
  }

  return content ? `${content}\n\n${summary}` : summary;
}

function appendAssistantText(content: string, text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return content;
  }

  return content ? `${content}\n\n${normalized}` : normalized;
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

function mergeToolCalls(existing: ToolCall[], incoming: ToolCall[]): ToolCall[] {
  if (incoming.length === 0) {
    return existing;
  }

  const merged = [...existing];
  const seen = new Set(existing.map((toolCall) => toolCall.id));

  for (const toolCall of incoming) {
    if (!seen.has(toolCall.id)) {
      merged.push(toolCall);
      seen.add(toolCall.id);
    }
  }

  return merged;
}

function createHistoryMessage(role: AgentMessage['role'], content: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    status: 'completed',
  };
}

function buildToolLoopPrompt(records: ToolExecutionRecord[]): string {
  const summaries = records
    .map(({ toolCall, result }) => {
      if (result.success && result.data !== undefined) {
        return `工具 ${toolCall.name} 执行成功，结果如下：\n${JSON.stringify(result.data, null, 2)}`;
      }
      if (result.success) {
        return `工具 ${toolCall.name} 执行成功。`;
      }
      return `工具 ${toolCall.name} 执行失败：${result.error || '未知错误'}`;
    })
    .join('\n\n');

  return `以下是工具执行的结果：\n\n${summaries}\n\n请根据这些结果继续处理或给出最终回复。`;
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
    case 'ADD_TOOL_RESULT':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.toolCalls?.some((toolCall) => toolCall.id === action.payload.toolCallId)
            ? {
                ...message,
                content: appendToolSummary(message.content, action.payload.summary),
                toolResults: {
                  ...(message.toolResults || {}),
                  [action.payload.toolCallId]: action.payload.result,
                },
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
  const pendingContinuationRef = useRef<PendingAgentContinuation | null>(null);

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
      committedContent: '',
      canceled: false,
      stopHandled: false,
      toolCalls: [],
    };
    activeRequestRef.current = requestState;

    const ensureRequestActive = () => {
      if (requestState.canceled || requestState.controller.signal.aborted || activeRequestRef.current !== requestState) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
    };

    const updateAssistantMessage = (updates: Partial<AgentMessage>) => {
      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: { id: assistantMessage.id, updates },
      });
    };

    const appendChunkToAssistant = (chunk: string) => {
      requestState.content += chunk;
      updateAssistantMessage({ content: requestState.content });
    };

    const persistToolResult = (toolCall: ToolCall, result: ToolResult) => {
      dispatch({
        type: 'ADD_TOOL_RESULT',
        payload: {
          toolCallId: toolCall.id,
          result,
          summary: formatToolResultSummary(result, toolCall.name),
        },
      });
    };

    const setConfirmation = (
      toolCall: ToolCall,
      description: string,
      continuation: PendingAgentContinuation | null
    ) => {
      pendingContinuationRef.current = continuation;
      dispatch({
        type: 'SET_CONFIRMATION',
        payload: {
          id: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          description,
          pendingMessageId: assistantMessage.id,
        },
      });
    };

    const runToolCalls = async (
      continuation: PendingAgentContinuation
    ): Promise<'continue' | 'paused'> => {
      for (let index = continuation.nextToolIndex; index < continuation.pendingToolCalls.length; index += 1) {
        const toolCall = continuation.pendingToolCalls[index];
        continuation.nextToolIndex = index;
        ensureRequestActive();
        const result = await agentEngine.executeTool(toolCall);
        ensureRequestActive();

        if (result.requiresConfirmation) {
          setConfirmation(toolCall, result.confirmationMessage || '', continuation);

          if (activeRequestRef.current === requestState) {
            activeRequestRef.current = null;
            dispatch({ type: 'SET_PROCESSING', payload: false });
          }
          return 'paused';
        }

        continuation.toolResults.push({ toolCall, result });
        continuation.nextToolIndex = index + 1;
        persistToolResult(toolCall, result);
      }

      return 'continue';
    };

    const continueAgentLoop = async (
      baseMessages: AgentMessage[],
      model: string,
      initialPrompt: string
    ) => {
      let iteration = 0;
      let conversationMessages = baseMessages;
      let prompt = initialPrompt;

      while (iteration < MAX_AGENT_ITERATIONS) {
        ensureRequestActive();

        let loopRawResponse = '';
        const loopInput = prompt ? conversationMessages.concat(createHistoryMessage('user', prompt)) : conversationMessages;

        for await (const chunk of agentEngine.processMessage(
          loopInput,
          model,
          requestState.controller.signal
        )) {
          ensureRequestActive();

          if (typeof chunk === 'string') {
            loopRawResponse += chunk;
            appendChunkToAssistant(chunk);
          } else if (chunk.type === 'tool_call') {
            requestState.toolCalls = mergeToolCalls(requestState.toolCalls, [chunk.toolCall]);
            updateAssistantMessage({ toolCalls: requestState.toolCalls });
          }
        }

        ensureRequestActive();

        const { textContent, toolCalls } = agentEngine.parseToolCalls(loopRawResponse);
        if (textContent.trim()) {
          requestState.committedContent = appendAssistantText(requestState.committedContent, textContent);
          requestState.content = requestState.committedContent;
          updateAssistantMessage({ content: requestState.committedContent });
        } else {
          requestState.content = requestState.committedContent;
          updateAssistantMessage({ content: requestState.committedContent });
        }

        if (textContent.trim()) {
          conversationMessages = conversationMessages.concat(createHistoryMessage('assistant', textContent));
        }

        if (toolCalls.length === 0) {
          return;
        }

        requestState.toolCalls = mergeToolCalls(requestState.toolCalls, toolCalls);
        updateAssistantMessage({ toolCalls: requestState.toolCalls });

        const continuation: PendingAgentContinuation = {
          assistantMessageId: assistantMessage.id,
          model,
          iteration,
          conversationMessages,
          assistantText: textContent,
          pendingToolCalls: toolCalls,
          nextToolIndex: 0,
          toolResults: [],
          renderedContent: requestState.committedContent,
          accumulatedToolCalls: requestState.toolCalls,
        };

        const executionState = await runToolCalls(continuation);
        if (executionState === 'paused') {
          return;
        }

        prompt = buildToolLoopPrompt(continuation.toolResults);
        conversationMessages = conversationMessages.concat(createHistoryMessage('user', prompt));
        iteration += 1;
        prompt = '';
      }
    };

    try {
      const directToolCall = agentEngine.findDirectToolCall(content);

      if (directToolCall) {
        requestState.toolCalls = [directToolCall];
        updateAssistantMessage({ toolCalls: [directToolCall] });

        ensureRequestActive();
        const result = await agentEngine.executeTool(directToolCall);
        ensureRequestActive();

        if (result.requiresConfirmation) {
          setConfirmation(directToolCall, result.confirmationMessage || '', {
            assistantMessageId: assistantMessage.id,
            model: state.selectedModel,
            iteration: 0,
            conversationMessages: state.messages.concat(userMessage),
            assistantText: '',
            pendingToolCalls: [directToolCall],
            nextToolIndex: 0,
            toolResults: [],
            renderedContent: '',
            accumulatedToolCalls: [directToolCall],
          });

          if (activeRequestRef.current === requestState) {
            activeRequestRef.current = null;
            dispatch({ type: 'SET_PROCESSING', payload: false });
          }
          return;
        }

        persistToolResult(directToolCall, result);

        if (activeRequestRef.current === requestState) {
          updateAssistantMessage({ status: 'completed' });
        }
        return;
      }

      await continueAgentLoop(state.messages.concat(userMessage), state.selectedModel, '');

      if (activeRequestRef.current === requestState) {
        updateAssistantMessage({ status: 'completed' });
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

    const continuation = pendingContinuationRef.current;
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

      if (continuation) {
        continuation.toolResults.push({
          toolCall: {
            id: confirmationRequest.id,
            name: confirmationRequest.toolName,
            arguments: confirmationRequest.arguments,
          },
          result,
        });
        continuation.nextToolIndex += 1;
        pendingContinuationRef.current = continuation;
      }

      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          id: confirmationRequest.pendingMessageId,
          updates: { status: continuation ? 'streaming' : 'completed' },
        },
      });

      if (continuation) {
        const requestState: ActiveRequestState = {
          controller: new AbortController(),
          assistantMessageId: continuation.assistantMessageId,
          content: continuation.renderedContent,
          committedContent: continuation.renderedContent,
          canceled: false,
          stopHandled: false,
          toolCalls: continuation.accumulatedToolCalls,
        };
        activeRequestRef.current = requestState;

        const ensureRequestActive = () => {
          if (requestState.canceled || requestState.controller.signal.aborted || activeRequestRef.current !== requestState) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
        };

        const updateAssistantMessage = (updates: Partial<AgentMessage>) => {
          dispatch({
            type: 'UPDATE_MESSAGE',
            payload: { id: continuation.assistantMessageId, updates },
          });
        };

        try {
          for (let index = continuation.nextToolIndex; index < continuation.pendingToolCalls.length; index += 1) {
            const toolCall = continuation.pendingToolCalls[index];
            ensureRequestActive();
            const toolResult = await agentEngine.executeTool(toolCall);
            ensureRequestActive();

            if (toolResult.requiresConfirmation) {
              pendingContinuationRef.current = {
                ...continuation,
                nextToolIndex: index,
                renderedContent: requestState.committedContent,
              };
              dispatch({
                type: 'SET_CONFIRMATION',
                payload: {
                  id: toolCall.id,
                  toolName: toolCall.name,
                  arguments: toolCall.arguments,
                  description: toolResult.confirmationMessage || '',
                  pendingMessageId: continuation.assistantMessageId,
                },
              });
              activeRequestRef.current = null;
              dispatch({ type: 'SET_PROCESSING', payload: false });
              return;
            }

            continuation.toolResults.push({ toolCall, result: toolResult });
            continuation.nextToolIndex = index + 1;

            dispatch({
              type: 'ADD_TOOL_RESULT',
              payload: {
                toolCallId: toolCall.id,
                result: toolResult,
                summary: formatToolResultSummary(toolResult, toolCall.name),
              },
            });
          }

          pendingContinuationRef.current = null;

          if (continuation.iteration + 1 < MAX_AGENT_ITERATIONS) {
            const followupPrompt = buildToolLoopPrompt(continuation.toolResults);
            const requestMessages = continuation.conversationMessages.concat(
              createHistoryMessage('user', followupPrompt)
            );

            let rawResponse = '';
            for await (const chunk of agentEngine.processMessage(
              requestMessages,
              continuation.model,
              requestState.controller.signal
            )) {
              ensureRequestActive();

              if (typeof chunk === 'string') {
                rawResponse += chunk;
                requestState.content += chunk;
                updateAssistantMessage({ content: requestState.content });
              } else if (chunk.type === 'tool_call') {
                requestState.toolCalls = mergeToolCalls(requestState.toolCalls, [chunk.toolCall]);
                continuation.accumulatedToolCalls = requestState.toolCalls;
                updateAssistantMessage({ toolCalls: requestState.toolCalls });
              }
            }

            const { textContent, toolCalls } = agentEngine.parseToolCalls(rawResponse);
            if (textContent.trim()) {
              requestState.committedContent = appendAssistantText(requestState.committedContent, textContent);
              requestState.content = requestState.committedContent;
              updateAssistantMessage({ content: requestState.committedContent });
            } else {
              requestState.content = requestState.committedContent;
              updateAssistantMessage({ content: requestState.committedContent });
            }

            if (toolCalls.length > 0) {
              const nextContinuation: PendingAgentContinuation = {
                assistantMessageId: continuation.assistantMessageId,
                model: continuation.model,
                iteration: continuation.iteration + 1,
                conversationMessages: textContent.trim()
                  ? requestMessages.concat(createHistoryMessage('assistant', textContent))
                  : requestMessages,
                assistantText: textContent,
                pendingToolCalls: toolCalls,
                nextToolIndex: 0,
                toolResults: [],
                renderedContent: requestState.committedContent,
                accumulatedToolCalls: mergeToolCalls(requestState.toolCalls, toolCalls),
              };
              pendingContinuationRef.current = nextContinuation;
              requestState.toolCalls = nextContinuation.accumulatedToolCalls;
              updateAssistantMessage({ toolCalls: requestState.toolCalls });

              for (let index = 0; index < toolCalls.length; index += 1) {
                const toolCall = toolCalls[index];
                ensureRequestActive();
                const toolResult = await agentEngine.executeTool(toolCall);
                ensureRequestActive();

                if (toolResult.requiresConfirmation) {
                  nextContinuation.nextToolIndex = index;
                  nextContinuation.renderedContent = requestState.committedContent;
                  dispatch({
                    type: 'SET_CONFIRMATION',
                    payload: {
                      id: toolCall.id,
                      toolName: toolCall.name,
                      arguments: toolCall.arguments,
                      description: toolResult.confirmationMessage || '',
                      pendingMessageId: continuation.assistantMessageId,
                    },
                  });
                  activeRequestRef.current = null;
                  dispatch({ type: 'SET_PROCESSING', payload: false });
                  return;
                }

                nextContinuation.toolResults.push({ toolCall, result: toolResult });
                nextContinuation.nextToolIndex = index + 1;
                dispatch({
                  type: 'ADD_TOOL_RESULT',
                  payload: {
                    toolCallId: toolCall.id,
                    result: toolResult,
                    summary: formatToolResultSummary(toolResult, toolCall.name),
                  },
                });
              }

              pendingContinuationRef.current = null;
            }
          }

          updateAssistantMessage({ status: 'completed' });
        } finally {
          if (activeRequestRef.current === requestState) {
            activeRequestRef.current = null;
          }
        }
      }
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

    pendingContinuationRef.current = null;
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
