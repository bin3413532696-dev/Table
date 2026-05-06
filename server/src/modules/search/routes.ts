import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import { searchAll } from './service';
import { unifiedSearchQuerySchema } from './schema';

export async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = unifiedSearchQuerySchema.parse(request.query);
      const items = await searchAll(query);
      return {
        items,
        total: items.length,
        source: 'postgres',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
