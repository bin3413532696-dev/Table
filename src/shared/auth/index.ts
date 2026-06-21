import { readApiErrorMessage } from '../api/error';

export const USER_ID_STORAGE_KEY = 'auth_user_id';
export const USER_ID_HEADER = 'x-user-id';
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
export const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

let csrfBootstrapPromise: Promise<void> | null = null;

function methodRequiresCsrf(method?: string): boolean {
  const normalized = method?.toUpperCase() ?? 'GET';
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

export type AuthMeResponse = {
  data: {
    user: {
      id: string;
      displayName: string;
      email: string | null;
      status: string;
      bio: string;
      createdAt: string;
      updatedAt: string;
    };
    auth: {
      userIdHeader: string;
      source: 'default' | 'header' | 'signed_session' | 'missing';
      isDefaultUser: boolean;
      devSessionCookie: string;
    };
  };
};

export type AuthUserListResponse = {
  data: {
    items: Array<AuthMeResponse['data']['user'] & { isCurrentUser: boolean }>;
    total: number;
  };
};

export type AuthCreateUserResponse = {
  data: {
    user: AuthMeResponse['data']['user'];
  };
};

export interface UpdateAuthMeInput {
  displayName?: string;
  email?: string | null;
  bio?: string;
}

export interface CreateAuthUserInput {
  id?: string;
  displayName: string;
  email?: string | null;
  bio?: string;
}

export function getCurrentUserId(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_USER_ID;
  }

  const stored = window.localStorage.getItem(USER_ID_STORAGE_KEY);
  return stored && stored.trim().length > 0 ? stored.trim() : DEFAULT_USER_ID;
}

export function setCurrentUserId(userId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = userId.trim();
  if (!normalized || normalized === DEFAULT_USER_ID) {
    window.localStorage.removeItem(USER_ID_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(USER_ID_STORAGE_KEY, normalized);
}

function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}

async function ensureCsrfCookie(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  if (getCsrfTokenFromCookie()) {
    return;
  }

  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = (async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: buildAuthenticatedHeaders(undefined, 'GET'),
      });

      if (!response.ok) {
        throw new Error(`Failed to initialize auth context: HTTP ${response.status}`);
      }
    })().finally(() => {
      csrfBootstrapPromise = null;
    });
  }

  await csrfBootstrapPromise;
}

export function buildAuthenticatedHeaders(headers?: HeadersInit, method?: string): Headers {
  const next = new Headers(headers);

  if (methodRequiresCsrf(method)) {
    const csrfToken = getCsrfTokenFromCookie();
    if (csrfToken) {
      next.set(CSRF_HEADER_NAME, csrfToken);
    }
  }

  return next;
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (methodRequiresCsrf(init?.method)) {
    await ensureCsrfCookie();
  }

  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: buildAuthenticatedHeaders(init?.headers, init?.method),
  });
}

export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/me');
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to load auth context: HTTP ${response.status}`));
  }
  return response.json() as Promise<AuthMeResponse>;
}

export async function fetchAuthUsers(): Promise<AuthUserListResponse> {
  const response = await fetchWithAuth('/api/auth/users');
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to load auth users: HTTP ${response.status}`));
  }
  return response.json() as Promise<AuthUserListResponse>;
}

export async function updateAuthMe(input: UpdateAuthMeInput): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to update auth context: HTTP ${response.status}`));
  }
  return response.json() as Promise<AuthMeResponse>;
}

export async function createAuthUser(input: CreateAuthUserInput): Promise<AuthCreateUserResponse> {
  const response = await fetchWithAuth('/api/auth/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to create user: HTTP ${response.status}`));
  }
  return response.json() as Promise<AuthCreateUserResponse>;
}

export async function switchAuthSession(userId: string): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to switch auth session: HTTP ${response.status}`));
  }

  return response.json() as Promise<AuthMeResponse>;
}

export async function clearAuthSession(): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/session', {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to clear auth session: HTTP ${response.status}`));
  }
  return response.json() as Promise<AuthMeResponse>;
}

export interface PinStatusResponse {
  enabled: boolean;
}

export async function fetchPinStatus(): Promise<PinStatusResponse> {
  const response = await fetchWithAuth('/api/auth/pin');
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to fetch PIN status: HTTP ${response.status}`));
  }
  return response.json() as Promise<PinStatusResponse>;
}

export async function verifyPinApi(pin: string): Promise<{ valid: boolean }> {
  const response = await fetchWithAuth('/api/auth/pin/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to verify PIN: HTTP ${response.status}`));
  }
  return response.json() as Promise<{ valid: boolean }>;
}

export async function setPinApi(pin: string): Promise<{ success: boolean }> {
  const response = await fetchWithAuth('/api/auth/pin', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to set PIN: HTTP ${response.status}`));
  }
  return response.json() as Promise<{ success: boolean }>;
}

export async function clearPinApi(): Promise<{ success: boolean }> {
  const response = await fetchWithAuth('/api/auth/pin', {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `Failed to clear PIN: HTTP ${response.status}`));
  }
  return response.json() as Promise<{ success: boolean }>;
}
