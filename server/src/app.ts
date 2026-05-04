import Fastify from 'fastify';
import { healthRoutes } from './modules/health/routes';
import { taskRoutes } from './modules/tasks/routes';
import { financeRoutes } from './modules/finance/routes';
import { knowledgeRoutes } from './modules/knowledge/routes';
import { maintenanceRoutes } from './modules/maintenance/routes';
import { registerProjectionRuntime } from './modules/projection/runtime';

export function createApp() {
  const app = Fastify({
    logger: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (!reply.sent) {
      reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.register(healthRoutes, { prefix: '/api/health' });
  app.register(taskRoutes, { prefix: '/api/tasks' });
  app.register(financeRoutes, { prefix: '/api/finance' });
  app.register(knowledgeRoutes, { prefix: '/api' });
  app.register(maintenanceRoutes, { prefix: '/api/maintenance' });
  registerProjectionRuntime(app);

  return app;
}
