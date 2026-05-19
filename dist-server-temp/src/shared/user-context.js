"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEV_SESSION_COOKIE = exports.USER_ID_HEADER = void 0;
exports.getDefaultUserId = getDefaultUserId;
exports.resolveRequestUserContext = resolveRequestUserContext;
exports.runWithUserContext = runWithUserContext;
exports.getCurrentUserContext = getCurrentUserContext;
exports.getCurrentUserId = getCurrentUserId;
const node_async_hooks_1 = require("node:async_hooks");
const config_1 = require("./config");
const session_1 = require("./session");
exports.USER_ID_HEADER = 'x-user-id';
exports.DEV_SESSION_COOKIE = 'table_dev_session_user_id';
const userContextStorage = new node_async_hooks_1.AsyncLocalStorage();
function getDefaultUserId() {
    return (0, config_1.loadServerConfig)().DEFAULT_USER_ID;
}
function readCookieValue(request, cookieName) {
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
        }
        catch {
            return value;
        }
    }
    return null;
}
function resolveRequestUserContext(request) {
    const config = (0, config_1.loadServerConfig)();
    // 1. 检查签名 Cookie（最高优先级）
    const cookieValue = readCookieValue(request, exports.DEV_SESSION_COOKIE);
    if (cookieValue && (0, session_1.isSignedToken)(cookieValue)) {
        const verifiedUserId = (0, session_1.verifySessionToken)(cookieValue);
        if (verifiedUserId) {
            return { userId: verifiedUserId, source: 'signed_session' };
        }
        // 签名无效或过期，继续尝试其他方式
    }
    // 2. 检查 x-user-id 头（受 TRUST_USER_ID_HEADER 控制）
    const headerValue = request.headers[exports.USER_ID_HEADER];
    const hasHeader = typeof headerValue === 'string' && headerValue.trim().length > 0;
    if (hasHeader && config.TRUST_USER_ID_HEADER) {
        return { userId: headerValue.trim(), source: 'header' };
    }
    // 3. 回退到默认用户
    return { userId: getDefaultUserId(), source: 'missing' };
}
function runWithUserContext(context, callback) {
    return userContextStorage.run(context, callback);
}
function getCurrentUserContext() {
    return userContextStorage.getStore() ?? {
        userId: getDefaultUserId(),
        source: 'missing',
    };
}
function getCurrentUserId() {
    return getCurrentUserContext().userId;
}
