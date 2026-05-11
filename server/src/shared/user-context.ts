import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';
import { loadServerConfig } from './config';
import { verifySessionToken, isSignedToken } from './session';

export const USER_ID_HEADER = 'x-user-id';
export const DEV_SESSION_COOKIE = 'table_dev_session_user_id';

export type ServerUserContext = {
  userId: string;
  source: 'default' | 'header' | 'signed_session' | 'missing';
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
  const config = loadServerConfig();

  // 1. 检查签名 Cookie（最高优先级）
  const cookieValue = readCookieValue(request, DEV_SESSION_COOKIE);
  if (cookieValue && isSignedToken(cookieValue)) {
    const verifiedUserId = verifySessionToken(cookieValue);
    if (verifiedUserId) {
      return { userId: verifiedUserId, source: 'signed_session' };
    }
    // 签名无效或过期，继续尝试其他方式
  }

  // 2. 检查 x-user-id 头（受 TRUST_USER_ID_HEADER 控制）
  const headerValue = request.headers[USER_ID_HEADER];
  const hasHeader = typeof headerValue === 'string' && headerValue.trim().length > 0;
  if (hasHeader && config.TRUST_USER_ID_HEADER) {
    return { userId: headerValue.trim(), source: 'header' };
  }

  // 3. 回退到默认用户
  return { userId: getDefaultUserId(), source: 'missing' };
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
