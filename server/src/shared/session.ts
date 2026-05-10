import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { loadServerConfig } from './config';

function getSigningKey(): Buffer {
  const secret = loadServerConfig().PROVIDER_SECRET_KEY;
  return createHash('sha256').update(secret).digest();
}

function computeHmac(userId: string, expiresAt: number): Buffer {
  return createHmac('sha256', getSigningKey())
    .update(`${userId}.${expiresAt}`)
    .digest();
}

export function signSessionToken(userId: string, ttlSeconds: number = 86400): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = computeHmac(userId, expiresAt);
  return `${userId}.${expiresAt}.${signature.toString('base64')}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [userId, expiresAtStr, signatureB64] = parts;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }

  if (Math.floor(Date.now() / 1000) > expiresAt) {
    return null;
  }

  try {
    const expected = computeHmac(userId, expiresAt);
    const actual = Buffer.from(signatureB64, 'base64');

    if (actual.length !== expected.length) {
      return null;
    }

    if (!timingSafeEqual(actual, expected)) {
      return null;
    }

    return userId;
  } catch {
    return null;
  }
}

export function isSignedToken(value: string): boolean {
  return value.split('.').length === 3;
}
