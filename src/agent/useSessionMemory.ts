import { useCallback, useEffect, useRef } from 'react';
import {
  deleteAgentSessionMemory,
  fetchAgentSessionMemory,
  updateAgentSessionMemorySettings,
} from '../lib/agentApi';
import type { AgentAction } from './state';
import { isValidAgentSessionId } from './storage';

interface UseSessionMemoryOptions {
  currentSessionId: string;
  dispatch: React.Dispatch<AgentAction>;
  currentSessionMemoryStatus?: string | null;
}

export function useSessionMemory({
  currentSessionId,
  dispatch,
  currentSessionMemoryStatus,
}: UseSessionMemoryOptions) {
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const scheduleMemoryPoll = useCallback((sessionId: string, attemptsRemaining: number) => {
    stopPolling();
    if (attemptsRemaining <= 0) {
      return;
    }

    pollTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const memory = await fetchAgentSessionMemory(sessionId);
          dispatch({ type: 'SET_SESSION_MEMORY', payload: memory });

          if (memory.status === 'pending' || memory.status === 'processing') {
            scheduleMemoryPoll(sessionId, attemptsRemaining - 1);
            return;
          }

          if (memory.status === 'idle' && Number(memory.runCount) === 0) {
            scheduleMemoryPoll(sessionId, attemptsRemaining - 1);
            return;
          }

          stopPolling();
        } catch (error) {
          console.warn('[Agent] Failed to poll session memory:', error);
          scheduleMemoryPoll(sessionId, attemptsRemaining - 1);
        }
      })();
    }, 2000);
  }, [dispatch, stopPolling]);

  const refreshSessionMemory = useCallback(async (
    sessionId?: string,
    options?: { backgroundPoll?: boolean }
  ) => {
    const targetSessionId = sessionId ?? currentSessionId;
    if (!isValidAgentSessionId(targetSessionId)) {
      stopPolling();
      dispatch({ type: 'SET_SESSION_MEMORY', payload: null });
      return;
    }

    try {
      const memory = await fetchAgentSessionMemory(targetSessionId);
      dispatch({ type: 'SET_SESSION_MEMORY', payload: memory });

      if (options?.backgroundPoll) {
        if (memory.status === 'pending' || memory.status === 'processing' || (memory.status === 'idle' && Number(memory.runCount) === 0)) {
          scheduleMemoryPoll(targetSessionId, 8);
        } else {
          stopPolling();
        }
      }
    } catch (error) {
      console.warn('[Agent] Failed to refresh session memory:', error);
    }
  }, [currentSessionId, dispatch, scheduleMemoryPoll, stopPolling]);

  const deleteSessionMemory = useCallback(async (sessionId?: string) => {
    const targetSessionId = sessionId ?? currentSessionId;
    if (!isValidAgentSessionId(targetSessionId)) {
      return;
    }

    const memory = await deleteAgentSessionMemory(targetSessionId);
    dispatch({ type: 'SET_SESSION_MEMORY', payload: memory });
  }, [currentSessionId, dispatch]);

  const setSessionMemoryDisabled = useCallback(async (disabled: boolean, sessionId?: string) => {
    const targetSessionId = sessionId ?? currentSessionId;
    if (!isValidAgentSessionId(targetSessionId)) {
      return;
    }

    const memory = await updateAgentSessionMemorySettings(targetSessionId, { disabled });
    dispatch({ type: 'SET_SESSION_MEMORY', payload: memory });
  }, [currentSessionId, dispatch]);

  useEffect(() => {
    void refreshSessionMemory();
  }, [refreshSessionMemory, currentSessionId]);

  useEffect(() => {
    if (!currentSessionMemoryStatus || !['pending', 'processing'].includes(currentSessionMemoryStatus)) {
      return;
    }

    scheduleMemoryPoll(currentSessionId, 8);
    return stopPolling;
  }, [currentSessionId, currentSessionMemoryStatus, scheduleMemoryPoll, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  return {
    refreshSessionMemory,
    deleteSessionMemory,
    setSessionMemoryDisabled,
  };
}
