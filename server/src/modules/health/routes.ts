import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return {
      ok: true,
      service: 'table-api',
      timestamp: new Date().toISOString(),
    };
  });
}
