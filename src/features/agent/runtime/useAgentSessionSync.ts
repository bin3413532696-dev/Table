import { useEffect } from 'react';
import type { AgentAction } from './state';
import { SESSION_ID_KEY } from './storage';

export function useAgentSessionSync(
  currentSessionId: string,
  dispatch: React.Dispatch<AgentAction>
) {
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === SESSION_ID_KEY && event.newValue && event.newValue !== currentSessionId) {
        dispatch({ type: 'UPDATE_SESSION_ID', payload: event.newValue });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [currentSessionId, dispatch]);
}
