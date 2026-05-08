import Fastify from 'fastify';
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

  app.addHook('onResponse', (request, reply, done) => {
    app.log.info({
      req: {
        method: request.method,
        url: request.url,
        query: request.query,
        body: request.body,
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
