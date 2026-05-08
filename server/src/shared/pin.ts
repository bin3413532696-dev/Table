import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

export function hashPin(plainPin: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(plainPin, salt, KEY_LENGTH);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPin(plainPin: string, hashedPin: string): boolean {
  const [saltBase64, hashBase64] = hashedPin.split(':');
  if (!saltBase64 || !hashBase64) {
    return false;
  }

  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const expectedHash = Buffer.from(hashBase64, 'base64');
    const actualHash = scryptSync(plainPin, salt, expectedHash.length);

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
