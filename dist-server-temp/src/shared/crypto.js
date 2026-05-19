"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptProviderSecret = encryptProviderSecret;
exports.decryptProviderSecret = decryptProviderSecret;
exports.maskProviderSecret = maskProviderSecret;
exports.hasProviderSecret = hasProviderSecret;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
const ENCRYPTION_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function getProviderKeyMaterial() {
    const secret = (0, config_1.loadServerConfig)().PROVIDER_SECRET_KEY;
    return (0, node_crypto_1.createHash)('sha256').update(secret).digest();
}
function isEncryptedPayload(value) {
    return value.startsWith(`${ENCRYPTION_VERSION}:`);
}
function encryptProviderSecret(plainText) {
    const normalized = plainText.trim();
    if (!normalized) {
        return '';
    }
    if (isEncryptedPayload(normalized)) {
        return normalized;
    }
    const iv = (0, node_crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, node_crypto_1.createCipheriv)(ALGORITHM, getProviderKeyMaterial(), iv);
    const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${ENCRYPTION_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}
function decryptProviderSecret(value) {
    const normalized = value?.trim() ?? '';
    if (!normalized) {
        return '';
    }
    if (!isEncryptedPayload(normalized)) {
        return normalized;
    }
    try {
        const [, ivBase64, authTagBase64, encryptedBase64] = normalized.split(':');
        if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
            console.warn('[CRYPTO] Invalid encrypted provider secret payload format');
            return '';
        }
        const iv = Buffer.from(ivBase64, 'base64');
        const authTag = Buffer.from(authTagBase64, 'base64');
        const encrypted = Buffer.from(encryptedBase64, 'base64');
        if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
            console.warn('[CRYPTO] Invalid encrypted provider secret metadata length');
            return '';
        }
        const decipher = (0, node_crypto_1.createDecipheriv)(ALGORITHM, getProviderKeyMaterial(), iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    }
    catch (error) {
        console.warn('[CRYPTO] Failed to decrypt provider secret - data may be encrypted with old key:', error instanceof Error ? error.message : 'Unknown error');
        return '';
    }
}
function maskProviderSecret(value) {
    const plainText = decryptProviderSecret(value);
    if (!plainText) {
        return '';
    }
    const visibleTail = plainText.slice(-4);
    return `••••••••${visibleTail}`;
}
function hasProviderSecret(value) {
    return decryptProviderSecret(value).trim().length > 0;
}
