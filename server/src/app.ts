import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './modules/auth/routes';
import { healthRoutes } from './modules/health/routes';
import { taskRoutes } from './modules/tasks/routes';
import { financeRoutes } from './modules/finance/routes';
import { knowledgeRoutes } from './modules/knowledge/routes';
import { maintenanceRoutes } from './modules/maintenance/routes';
import { agentRoutes } from './modules/agent/routes';
import { providerRoutes } from './modules/providers/routes';
import { authenticateRequest, runAuthenticatedRequest } from './shared/auth';
import { sendInfrastructureError } from './shared/http';

export function createApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (request.url.startsWith('/api/health')) {
      done();
      return;
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
      return reply.code(409).send({
        error: 'VERSION_CONFLICT',
        message: error.message || 'Resource was modified by another request. Please refresh and try again.',
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
  app.register(providerRoutes, { prefix: '/api' });
  app.register(agentRoutes, { prefix: '/api' });
  app.register(maintenanceRoutes, { prefix: '/api/maintenance' });

  return app;
}
