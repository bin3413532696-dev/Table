import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { AgentRunDetailDto, AgentSessionDetailDto } from '../lib/agentApi';
import {
  mapRunDetailToHistoryMessages,
  mapSessionDetailToHistoryMessages,
} from './messageUtils';
import {
  agentReducer,
  createInitialAgentState,
} from './state';
import type { AgentState } from './types';
import { useAgentRunActions } from './useAgentRunActions';
import { useAgentRuntime } from './useAgentRuntime';
import { useAgentSessionSync } from './useAgentSessionSync';
import { useSessionMemory } from './useSessionMemory';

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
  refreshSessionMemory: (
    sessionId?: string,
    options?: { backgroundPoll?: boolean }
  ) => Promise<void>;
  deleteSessionMemory: (sessionId?: string) => Promise<void>;
  setSessionMemoryDisabled: (disabled: boolean, sessionId?: string) => Promise<void>;
  toggleRag: () => void;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, undefined, createInitialAgentState);

  const { checkConnection } = useAgentRuntime(dispatch);
  useAgentSessionSync(state.currentSessionId, dispatch);

  const {
    refreshSessionMemory,
    deleteSessionMemory,
    setSessionMemoryDisabled,
  } = useSessionMemory({
    currentSessionId: state.currentSessionId,
    currentSessionMemoryStatus: state.currentSessionMemory?.status ?? null,
    dispatch,
  });

  const {
    sendMessage,
    stopThinking,
    confirmAction,
    rejectAction,
  } = useAgentRunActions({
    state,
    dispatch,
    refreshSessionMemory,
  });

  const clearConversation = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const newSession = useCallback((sessionId?: string) => {
    dispatch({ type: 'NEW_SESSION', payload: sessionId });
  }, []);

  const selectModel = useCallback((model: string) => {
    dispatch({ type: 'SELECT_MODEL', payload: model });
  }, []);

  const toggleRag = useCallback(() => {
    dispatch({ type: 'SET_RAG_ENABLED', payload: !state.ragEnabled });
  }, [state.ragEnabled]);

  const loadHistoryRun = useCallback((run: AgentRunDetailDto) => {
    dispatch({
      type: 'LOAD_HISTORY',
      payload: {
        messages: mapRunDetailToHistoryMessages(run),
        runId: run.id,
        sessionId: run.sessionId ?? null,
      },
    });
  }, []);

  const loadHistorySession = useCallback((session: AgentSessionDetailDto) => {
    dispatch({
      type: 'LOAD_HISTORY',
      payload: {
        messages: mapSessionDetailToHistoryMessages(session),
        runId: session.runs[session.runs.length - 1]?.id ?? '',
        sessionId: session.id,
        memory: session.memory ?? null,
      },
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
    refreshSessionMemory,
    deleteSessionMemory,
    setSessionMemoryDisabled,
    toggleRag,
  }), [
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
    refreshSessionMemory,
    deleteSessionMemory,
    setSessionMemoryDisabled,
    toggleRag,
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
