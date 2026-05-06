import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import { createProviderSchema, providerIdParamSchema, updateProviderSchema } from './schema';
import {
  activateProviderForCurrentUser,
  createProviderForCurrentUser,
  deleteProviderForCurrentUser,
  getActiveProviderForCurrentUser,
  listProvidersForCurrentUser,
  updateProviderForCurrentUser,
} from './service';

export async function providerRoutes(app: FastifyInstance) {
  app.get('/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listProvidersForCurrentUser();
      return {
        data: {
          items,
          total: items.length,
        },
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/providers/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const provider = await getActiveProviderForCurrentUser();
      return {
        data: {
          provider,
        },
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createProviderSchema.parse(request.body);
      const provider = await createProviderForCurrentUser(payload);
      return reply.code(201).send({
        data: {
          provider,
        },
      });
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/providers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = providerIdParamSchema.parse(request.params);
      const payload = updateProviderSchema.parse(request.body);
      const provider = await updateProviderForCurrentUser(id, payload);
      if (!provider) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
      }
      return {
        data: {
          provider,
        },
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/providers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = providerIdParamSchema.parse(request.params);
      const result = await deleteProviderForCurrentUser(id);
      if (!result) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
      }
      return {
        data: result,
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/providers/:id/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = providerIdParamSchema.parse(request.params);
      const provider = await activateProviderForCurrentUser(id);
      if (!provider) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
      }
      return {
        data: {
          provider,
        },
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
