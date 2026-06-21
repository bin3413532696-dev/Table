export const SESSION_ID_KEY = 'agent_session_id';
export const RAG_ENABLED_KEY = 'agent_rag_enabled';
export const AGENT_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAgentSessionId(sessionId: string): boolean {
  return AGENT_SESSION_ID_PATTERN.test(sessionId);
}

export function getStoredSessionId(): string {
  if (typeof window === 'undefined') {
    return crypto.randomUUID();
  }

  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored) {
    return stored;
  }

  return crypto.randomUUID();
}

export function getStoredRagEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const stored = localStorage.getItem(RAG_ENABLED_KEY);
  if (stored == null) {
    return true;
  }

  return stored === 'true';
}

export function storeSessionId(sessionId: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
}

export function clearStoredSessionId() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_ID_KEY);
  }
}

export function storeRagEnabled(enabled: boolean) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(RAG_ENABLED_KEY, String(enabled));
  }
}
