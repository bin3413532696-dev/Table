"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSessionToken = signSessionToken;
exports.verifySessionToken = verifySessionToken;
exports.isSignedToken = isSignedToken;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
function getSigningKey() {
    const secret = (0, config_1.loadServerConfig)().PROVIDER_SECRET_KEY;
    return (0, node_crypto_1.createHash)('sha256').update(secret).digest();
}
function computeHmac(userId, expiresAt) {
    return (0, node_crypto_1.createHmac)('sha256', getSigningKey())
        .update(`${userId}.${expiresAt}`)
        .digest();
}
function signSessionToken(userId, ttlSeconds = 86400) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = computeHmac(userId, expiresAt);
    return `${userId}.${expiresAt}.${signature.toString('base64')}`;
}
function verifySessionToken(token) {
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
        if (!(0, node_crypto_1.timingSafeEqual)(actual, expected)) {
            return null;
        }
        return userId;
    }
    catch {
        return null;
    }
}
function isSignedToken(value) {
    return value.split('.').length === 3;
}
