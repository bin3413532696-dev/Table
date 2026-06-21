import { useCallback, useRef } from 'react';
import { MESSAGES } from '../../../core/messages';
import { financeApi } from '../../finance/public';
import { taskApi } from '../../tasks/public';
import type { AgentRunDetailDto, AgentRunStreamEvent } from '../api';
import {
  extractMessageTextFromLangGraphChunk,
  streamAgentRun,
  streamConfirmAgentToolExecution,
  streamRejectAgentToolExecution,
} from '../api';
import {
  appendManualStopMessage,
  toInitialMessages,
} from './messageUtils';
import type { AgentAction } from './state';
import { isValidAgentSessionId } from './storage';
import type { AgentMessage, AgentState, ToolCall, ToolResult } from './types';
import { useStreamingBuffer } from './useStreamingBuffer';

interface ActiveRequestState {
  controller: AbortController;
  assistantMessageId: string;
  content: string;
  canceled: boolean;
  stopHandled: boolean;
  toolCalls: ToolCall[];
  runId?: string;
}

interface UseAgentRunActionsOptions {
  state: AgentState;
  dispatch: React.Dispatch<AgentAction>;
  refreshSessionMemory: (
    sessionId?: string,
    options?: { backgroundPoll?: boolean }
  ) => Promise<void>;
}

export function useAgentRunActions({
  state,
  dispatch,
  refreshSessionMemory,
}: UseAgentRunActionsOptions) {
  const activeRequestRef = useRef<ActiveRequestState | null>(null);
  const { append: appendStreamingChunk, flush: flushStreamingChunks } = useStreamingBuffer((messageId, chunk) => {
    dispatch({
      type: 'APPEND_STREAMING_CONTENT',
      payload: { messageId, chunk },
    });
  });

  const applyRunResultToAssistantMessage = useCallback((
    assistantMessageId: string,
    run: AgentRunDetailDto
  ) => {
    const assistantReplies = run.messages.filter((message) => message.role === 'assistant');
    const assistantReply = assistantReplies[assistantReplies.length - 1];
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
  }, [dispatch]);

  const applyStreamEventToAssistantMessage = useCallback((
    assistantMessageId: string,
    event: AgentRunStreamEvent,
    requestState?: ActiveRequestState
  ) => {
    if (event.sessionId) {
      dispatch({ type: 'UPDATE_SESSION_ID', payload: event.sessionId });
    }

    if (event.type === 'metadata') {
      if (requestState && event.runId) {
        requestState.runId = event.runId;
      }
      return;
    }

    if (event.type === 'run_update') {
      if (event.run && event.run.status === 'waiting_confirmation') {
        if (requestState) {
          flushStreamingChunks();
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
        if (requestState) {
          flushStreamingChunks();
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

    if (event.type === 'token' && event.token) {
      if (requestState) {
        requestState.content += event.token;
      }

      appendStreamingChunk(assistantMessageId, event.token);
      return;
    }

    if (event.type === 'langgraph_chunk') {
      const textChunk = extractMessageTextFromLangGraphChunk(event);
      if (!textChunk) {
        return;
      }

      if (requestState) {
        requestState.content += textChunk;
      }

      appendStreamingChunk(assistantMessageId, textChunk);
    }
  }, [appendStreamingChunk, applyRunResultToAssistantMessage, dispatch, flushStreamingChunks]);

  const refreshCollectionsForRun = useCallback(async (run: AgentRunDetailDto) => {
    const completedToolNames = new Set(
      (run.executedToolCalls || [])
        .filter((execution) => execution.status === 'completed')
        .map((execution) => execution.toolName)
    );

    const refreshers: Array<Promise<unknown>> = [];
    if (
      completedToolNames.has('create_task') ||
      completedToolNames.has('update_task') ||
      completedToolNames.has('delete_task')
    ) {
      refreshers.push(taskApi.refresh());
    }

    if (completedToolNames.has('add_finance_record')) {
      refreshers.push(financeApi.refresh());
    }

    if (refreshers.length === 0) {
      return;
    }

    const results = await Promise.allSettled(refreshers);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('[Agent] Failed to refresh collection after confirmed tool execution:', result.reason);
      }
    });
  }, []);

  const shouldBackgroundPollMemory = useCallback(() => {
    const nextUserTurnCount = state.messages.filter((message) => message.role === 'user').length + 1;
    const currentMemoryStatus = state.currentSessionMemory?.status ?? null;
    return nextUserTurnCount >= 3 || currentMemoryStatus === 'pending' || currentMemoryStatus === 'processing';
  }, [state.currentSessionMemory?.status, state.messages]);

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
  }, [dispatch]);

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
      const requestBody: {
        inputText: string;
        model: string;
        sessionId?: string;
        ragEnabled?: boolean;
        initialMessages?: Array<{
          role: 'user' | 'assistant';
          content: string;
        }>;
      } = {
        inputText: content,
        model: state.selectedModel || 'default',
        ragEnabled: state.ragEnabled,
        initialMessages: toInitialMessages(state.messages),
      };

      if (isValidAgentSessionId(state.currentSessionId)) {
        requestBody.sessionId = state.currentSessionId;
      }

      const run = await streamAgentRun(requestBody, {
        onEvent: (event) => {
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

      flushStreamingChunks();
      dispatch({
        type: 'FINALIZE_STREAMING',
        payload: {
          messageId: assistantMessage.id,
          finalContent: requestState.content,
          updates: { status: 'completed' },
        },
      });
      applyRunResultToAssistantMessage(assistantMessage.id, run);
      await refreshSessionMemory(run.sessionId, { backgroundPoll: shouldBackgroundPollMemory() });
    } catch (error) {
      if (requestState.canceled || requestState.controller.signal.aborted) {
        if (!requestState.stopHandled && activeRequestRef.current === requestState) {
          flushStreamingChunks();
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

      flushStreamingChunks();
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
  }, [
    applyRunResultToAssistantMessage,
    applyStreamEventToAssistantMessage,
    dispatch,
    flushStreamingChunks,
    refreshSessionMemory,
    shouldBackgroundPollMemory,
    state.currentSessionId,
    state.isConnected,
    state.isProcessing,
    state.messages,
    state.ragEnabled,
    state.selectedModel,
  ]);

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
      await refreshCollectionsForRun(run);
      await refreshSessionMemory(run.sessionId, { backgroundPoll: true });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : MESSAGES.agent.executeFailed,
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [
    applyRunResultToAssistantMessage,
    applyStreamEventToAssistantMessage,
    dispatch,
    refreshCollectionsForRun,
    refreshSessionMemory,
    state.confirmationRequest,
  ]);

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
      await refreshSessionMemory(run.sessionId, { backgroundPoll: true });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : MESSAGES.agent.cancelFailed,
      });
    } finally {
      dispatch({ type: 'SET_PROCESSING', payload: false });
    }
  }, [
    applyRunResultToAssistantMessage,
    applyStreamEventToAssistantMessage,
    dispatch,
    refreshSessionMemory,
    state.confirmationRequest,
  ]);

  return {
    sendMessage,
    stopThinking,
    confirmAction,
    rejectAction,
  };
}
