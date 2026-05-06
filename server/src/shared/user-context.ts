import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';
import { loadServerConfig } from './config';

export const USER_ID_HEADER = 'x-user-id';
export const DEV_SESSION_COOKIE = 'table_dev_session_user_id';

export type ServerUserContext = {
  userId: string;
  source: 'default' | 'header' | 'session' | 'missing';
};

const userContextStorage = new AsyncLocalStorage<ServerUserContext>();

export function getDefaultUserId() {
  return loadServerConfig().DEFAULT_USER_ID;
}

function readCookieValue(request: FastifyRequest, cookieName: string): string | null {
  const rawCookie = request.headers.cookie;
  if (!rawCookie) {
    return null;
  }

  const cookieParts = rawCookie.split(';');
  for (const part of cookieParts) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name !== cookieName) {
      continue;
    }

    const value = valueParts.join('=').trim();
    if (!value) {
      return null;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function resolveRequestUserContext(request: FastifyRequest): ServerUserContext {
  const headerValue = request.headers[USER_ID_HEADER];
  const hasHeader = typeof headerValue === 'string' && headerValue.trim().length > 0;
  const sessionUserId = hasHeader ? null : readCookieValue(request, DEV_SESSION_COOKIE);
  const hasSession = typeof sessionUserId === 'string' && sessionUserId.trim().length > 0;
  const userId = hasHeader
    ? headerValue.trim()
    : hasSession
      ? sessionUserId.trim()
      : getDefaultUserId();

  return {
    userId,
    source: hasHeader
      ? 'header'
      : hasSession
        ? 'session'
        : 'missing',
  };
}

export function runWithUserContext<T>(context: ServerUserContext, callback: () => T) {
  return userContextStorage.run(context, callback);
}

export function getCurrentUserContext(): ServerUserContext {
  return userContextStorage.getStore() ?? {
    userId: getDefaultUserId(),
    source: 'missing',
  };
}

export function getCurrentUserId() {
  return getCurrentUserContext().userId;
}
