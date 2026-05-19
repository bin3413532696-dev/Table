"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPin = hashPin;
exports.verifyPin = verifyPin;
const node_crypto_1 = require("node:crypto");
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
function hashPin(plainPin) {
    const salt = (0, node_crypto_1.randomBytes)(SALT_LENGTH);
    const hash = (0, node_crypto_1.scryptSync)(plainPin, salt, KEY_LENGTH);
    return `${salt.toString('base64')}:${hash.toString('base64')}`;
}
function verifyPin(plainPin, hashedPin) {
    const [saltBase64, hashBase64] = hashedPin.split(':');
    if (!saltBase64 || !hashBase64) {
        return false;
    }
    try {
        const salt = Buffer.from(saltBase64, 'base64');
        const expectedHash = Buffer.from(hashBase64, 'base64');
        const actualHash = (0, node_crypto_1.scryptSync)(plainPin, salt, expectedHash.length);
        if (actualHash.length !== expectedHash.length) {
            return false;
        }
        return (0, node_crypto_1.timingSafeEqual)(actualHash, expectedHash);
    }
    catch {
        return false;
    }
}
