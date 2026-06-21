import { useCallback, useEffect } from 'react';
import { API_CONFIG_CHANGED_EVENT, getPreferredAgentModel } from '../../settings/public';
import {
  fetchAgentRuntimeStatus,
  fetchAgentSessionDetail,
  fetchAgentSessionList,
} from '../api';
import { mapRunMessagesToAgentMessages } from './messageUtils';
import type { AgentAction } from './state';

export function useAgentRuntime(dispatch: React.Dispatch<AgentAction>) {
  const handleRuntimeUnavailable = useCallback((error: unknown) => {
    dispatch({ type: 'SET_CONNECTED', payload: false });
    dispatch({ type: 'SET_MODELS', payload: [] });
    dispatch({ type: 'SELECT_MODEL', payload: getPreferredAgentModel() });
    dispatch({
      type: 'SET_ERROR',
      payload: error instanceof Error ? error.message : 'Agent runtime unavailable',
    });
  }, [dispatch]);

  const loadLatestSession = useCallback(async () => {
    try {
      const sessionList = await fetchAgentSessionList({ limit: 1 });
      if (sessionList.items.length === 0) {
        return;
      }

      const latestSession = sessionList.items[0];
      const detail = await fetchAgentSessionDetail(latestSession.id);
      if (detail.messages && detail.messages.length > 0) {
        dispatch({
          type: 'LOAD_HISTORY',
          payload: {
            messages: mapRunMessagesToAgentMessages(detail.messages),
            runId: detail.runs[detail.runs.length - 1]?.id ?? '',
            sessionId: detail.id,
            memory: detail.memory ?? null,
          },
        });
        return;
      }

      dispatch({ type: 'UPDATE_SESSION_ID', payload: latestSession.id });
      dispatch({ type: 'SET_SESSION_MEMORY', payload: detail.memory ?? null });
    } catch {
      // 历史同步失败不影响主流程
    }
  }, [dispatch]);

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

      await loadLatestSession();
    } catch (error) {
      handleRuntimeUnavailable(error);
    }
  }, [dispatch, handleRuntimeUnavailable, loadLatestSession]);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

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
  }, [checkConnection, dispatch]);

  return {
    checkConnection,
  };
}
