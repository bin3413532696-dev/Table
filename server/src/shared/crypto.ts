import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadServerConfig } from './config';

const ENCRYPTION_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getProviderKeyMaterial(): Buffer {
  const secret = loadServerConfig().PROVIDER_SECRET_KEY;
  return createHash('sha256').update(secret).digest();
}

function isEncryptedPayload(value: string): boolean {
  return value.startsWith(`${ENCRYPTION_VERSION}:`);
}

export function encryptProviderSecret(plainText: string): string {
  const normalized = plainText.trim();
  if (!normalized) {
    return '';
  }

  if (isEncryptedPayload(normalized)) {
    return normalized;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getProviderKeyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptProviderSecret(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return '';
  }

  if (!isEncryptedPayload(normalized)) {
    return normalized;
  }

  const [, ivBase64, authTagBase64, encryptedBase64] = normalized.split(':');
  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted provider secret payload');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted provider secret metadata');
  }

  const decipher = createDecipheriv(ALGORITHM, getProviderKeyMaterial(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskProviderSecret(value: string | null | undefined): string {
  const plainText = decryptProviderSecret(value);
  if (!plainText) {
    return '';
  }

  const visibleTail = plainText.slice(-4);
  return `••••••••${visibleTail}`;
}

export function hasProviderSecret(value: string | null | undefined): boolean {
  return decryptProviderSecret(value).trim().length > 0;
}
