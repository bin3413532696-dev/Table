import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError } from '../../shared/auth';
import { resolveRequestUserContext, getDefaultUserId } from '../../shared/user-context';
import { sendInfrastructureError } from '../../shared/http';
import { exportBusinessSnapshot, importBusinessSnapshot, resetWorkspaceData } from './service';

const importSnapshotSchema = z.object({
  version: z.number().optional(),
  tasks: z.array(z.unknown()).max(10000).optional(),
  finance: z.array(z.unknown()).max(10000).optional(),
});

const resetScopeSchema = z.object({
  scope: z.enum(['all', 'tasks', 'finance', 'knowledge']).default('all'),
});

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get('/business-snapshot', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await exportBusinessSnapshot();
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/business-snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = importSnapshotSchema.parse(request.body);
      const result = await importBusinessSnapshot(payload);
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/reset', {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: '10 minutes',
      },
    },
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const context = resolveRequestUserContext(request);
        if (context.userId !== getDefaultUserId()) {
          throw new AuthError('Only default user can reset workspace', 403, 'FORBIDDEN');
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = resetScopeSchema.parse(request.body ?? {});
      const result = await resetWorkspaceData(payload.scope);
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
