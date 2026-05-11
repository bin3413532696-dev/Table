export const USER_ID_STORAGE_KEY = 'auth_user_id';
export const USER_ID_HEADER = 'x-user-id';
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
export const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

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
      source: 'default' | 'header' | 'session';
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

/**
 * 从 Cookie 中读取 CSRF Token
 */
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

export function buildAuthenticatedHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  // 认证通过签名 Cookie 完成，不再需要 x-user-id 头

  // 添加 CSRF Token 到请求头（用于非 GET 请求的验证）
  const csrfToken = getCsrfTokenFromCookie();
  if (csrfToken) {
    next.set(CSRF_HEADER_NAME, csrfToken);
  }

  return next;
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: buildAuthenticatedHeaders(init?.headers),
  });
}

export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/me');
  if (!response.ok) {
    throw new Error(`Failed to load auth context: HTTP ${response.status}`);
  }
  return response.json() as Promise<AuthMeResponse>;
}

export async function fetchAuthUsers(): Promise<AuthUserListResponse> {
  const response = await fetchWithAuth('/api/auth/users');
  if (!response.ok) {
    throw new Error(`Failed to load auth users: HTTP ${response.status}`);
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
    let message = `Failed to update auth context: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
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
    let message = `Failed to create user: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
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
    let message = `Failed to switch auth session: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AuthMeResponse>;
}

export async function clearAuthSession(): Promise<AuthMeResponse> {
  const response = await fetchWithAuth('/api/auth/session', {
    method: 'DELETE',
  });

  if (!response.ok) {
    let message = `Failed to clear auth session: HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }

  return response.json() as Promise<AuthMeResponse>;
}

export interface PinStatusResponse {
  enabled: boolean;
}

export async function fetchPinStatus(): Promise<PinStatusResponse> {
  const response = await fetchWithAuth('/api/auth/pin');
  if (!response.ok) {
    throw new Error(`Failed to fetch PIN status: HTTP ${response.status}`);
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
    const payload = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new Error(payload.message || `Failed to verify PIN: HTTP ${response.status}`);
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
    const payload = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new Error(payload.message || `Failed to set PIN: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean }>;
}

export async function clearPinApi(): Promise<{ success: boolean }> {
  const response = await fetchWithAuth('/api/auth/pin', {
    method: 'DELETE',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new Error(payload.message || `Failed to clear PIN: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean }>;
}
