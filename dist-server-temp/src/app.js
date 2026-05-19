"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const routes_1 = require("./modules/auth/routes");
const routes_2 = require("./modules/health/routes");
const routes_3 = require("./modules/tasks/routes");
const routes_4 = require("./modules/finance/routes");
const routes_5 = require("./modules/knowledge/routes");
const routes_6 = require("./modules/maintenance/routes");
const routes_7 = require("./modules/agent/routes");
const routes_8 = require("./modules/providers/routes");
const auth_1 = require("./shared/auth");
const http_1 = require("./shared/http");
function createApp() {
    const app = (0, fastify_1.default)({
        logger: true,
    });
    app.register(cors_1.default, {
        origin: process.env.NODE_ENV === 'production'
            ? false
            : ['http://localhost:3266', 'http://127.0.0.1:3266'],
        credentials: true,
    });
    app.register(rate_limit_1.default, {
        max: 100,
        timeWindow: '1 minute',
    });
    // CSRF 验证钩子：非 GET 请求需要验证 Token
    app.addHook('onRequest', (request, reply, done) => {
        // 跳过健康检查端点
        if (request.url.startsWith('/api/health')) {
            done();
            return;
        }
        // GET 请求不需要 CSRF 验证（SameSite=Lax 已保护）
        if (request.method === 'GET') {
            done();
            return;
        }
        // 验证 CSRF Token
        if (!(0, auth_1.validateCsrfToken)(request)) {
            reply.code(403).send({
                error: 'FORBIDDEN',
                message: 'CSRF token validation failed',
            });
            return;
        }
        done();
    });
    app.addHook('onRequest', (request, reply, done) => {
        if (request.url.startsWith('/api/health')) {
            done();
            return;
        }
        const shouldSkipBaseline = request.method === 'GET' && request.url.startsWith('/api/agent/health');
        (0, auth_1.runAuthenticatedRequest)(request, () => {
            void (0, auth_1.authenticateRequest)(request, reply, {
                ensureBaseline: !shouldSkipBaseline,
            })
                .then(() => done())
                .catch(done);
        });
    });
    function sanitizeLogBody(body) {
        if (!body || typeof body !== 'object') {
            return body;
        }
        const sensitiveKeys = new Set([
            'apiKey', 'apiKeyEncrypted', 'api_key', 'api_key_encrypted',
            'password', 'pin', 'secret', 'token', 'authorization',
            'securityPin', 'security_pin', 'securityPinHash', 'security_pin_hash',
        ]);
        const clone = {};
        for (const [key, value] of Object.entries(body)) {
            if (sensitiveKeys.has(key.toLowerCase())) {
                clone[key] = '***';
            }
            else if (typeof value === 'object' && value !== null) {
                clone[key] = sanitizeLogBody(value);
            }
            else {
                clone[key] = value;
            }
        }
        return clone;
    }
    app.addHook('onResponse', (request, reply, done) => {
        app.log.info({
            req: {
                method: request.method,
                url: request.url,
                query: request.query,
                body: sanitizeLogBody(request.body),
            },
            res: {
                statusCode: reply.statusCode,
            },
            responseTime: reply.elapsedTime,
        }, `${request.method} ${request.url} ${reply.statusCode}`);
        done();
    });
    app.setErrorHandler((error, _request, reply) => {
        app.log.error(error);
        if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409) {
            const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
            return reply.code(409).send({
                error: 'VERSION_CONFLICT',
                message: message || 'Resource was modified by another request. Please refresh and try again.',
            });
        }
        if (!reply.sent) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.register(routes_2.healthRoutes, { prefix: '/api/health' });
    app.register(routes_1.authRoutes, { prefix: '/api/auth' });
    app.register(routes_3.taskRoutes, { prefix: '/api/tasks' });
    app.register(routes_4.financeRoutes, { prefix: '/api/finance' });
    app.register(routes_5.knowledgeRoutes, { prefix: '/api' });
    app.register(routes_8.providerRoutes, { prefix: '/api' });
    app.register(routes_7.agentRoutes, { prefix: '/api' });
    app.register(routes_6.maintenanceRoutes, { prefix: '/api/maintenance' });
    return app;
}
