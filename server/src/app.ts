import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './modules/auth/routes';
import { healthRoutes } from './modules/health/routes';
import { taskRoutes } from './modules/tasks/routes';
import { financeRoutes } from './modules/finance/routes';
import { knowledgeRoutes } from './modules/knowledge/routes';
import { knowledgeRagRoutes } from './modules/knowledge-rag/routes';
import { maintenanceRoutes } from './modules/maintenance/routes';
import { agentRoutes } from './modules/agent/routes';
import { providerRoutes } from './modules/providers/routes';
import { authenticateRequest, runAuthenticatedRequest, validateCsrfToken, CSRF_COOKIE_NAME, generateCsrfToken } from './shared/auth';
import { sendInfrastructureError } from './shared/http';

export function createApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:3266', 'http://127.0.0.1:3266'],
    credentials: true,
  });

  app.register(rateLimit, {
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
    if (!validateCsrfToken(request)) {
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

    // GET 请求：检查并设置 CSRF cookie（如果不存在）
    if (request.method === 'GET') {
      const cookieHeader = request.headers.cookie;
      let hasCsrfCookie = false;
      if (cookieHeader) {
        const cookies = cookieHeader.split(';');
        for (const cookie of cookies) {
          const [name] = cookie.trim().split('=');
          if (name === CSRF_COOKIE_NAME) {
            hasCsrfCookie = true;
            break;
          }
        }
      }

      // 如果没有 CSRF cookie，生成一个并设置
      if (!hasCsrfCookie) {
        const csrfToken = generateCsrfToken();
        const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        reply.header(
          'Set-Cookie',
          `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; SameSite=Lax${secureFlag}`
        );
      }
    }

    const shouldSkipBaseline =
      request.method === 'GET' && request.url.startsWith('/api/agent/health');

    runAuthenticatedRequest(request, () => {
      void authenticateRequest(request, reply, {
        ensureBaseline: !shouldSkipBaseline,
      })
        .then(() => done())
        .catch(done);
    });
  });

  function sanitizeLogBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') {
      return body;
    }
    const sensitiveKeys = new Set([
      'apiKey', 'apiKeyEncrypted', 'api_key', 'api_key_encrypted',
      'password', 'pin', 'secret', 'token', 'authorization',
      'securityPin', 'security_pin', 'securityPinHash', 'security_pin_hash',
    ]);
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        clone[key] = '***';
      } else if (typeof value === 'object' && value !== null) {
        clone[key] = sanitizeLogBody(value);
      } else {
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
      return sendInfrastructureError(reply, error);
    }
  });

  app.register(healthRoutes, { prefix: '/api/health' });
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(taskRoutes, { prefix: '/api/tasks' });
  app.register(financeRoutes, { prefix: '/api/finance' });
  app.register(knowledgeRoutes, { prefix: '/api' });
  app.register(knowledgeRagRoutes, { prefix: '/api' });
  app.register(providerRoutes, { prefix: '/api' });
  app.register(agentRoutes, { prefix: '/api' });
  app.register(maintenanceRoutes, { prefix: '/api/maintenance' });

  return app;
}
