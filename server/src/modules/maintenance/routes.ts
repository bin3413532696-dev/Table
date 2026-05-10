import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError } from '../../shared/auth';
import { resolveRequestUserContext, getDefaultUserId } from '../../shared/user-context';
import { sendInfrastructureError } from '../../shared/http';
import { exportBusinessSnapshot, importBusinessSnapshot, resetWorkspaceData } from './service';

const importSnapshotSchema = z.object({
  version: z.number().int().min(1).optional(),
  tasks: z.array(z.unknown()).max(10000).optional(),
  finance: z.array(z.unknown()).max(10000).optional(),
  knowledge: z.object({
    notes: z.array(z.unknown()).max(10000).optional(),
    presetTags: z.array(z.unknown()).max(1000).optional(),
  }).optional(),
});

const resetScopeSchema = z.object({
  scope: z.enum(['all', 'tasks', 'finance', 'knowledge']).default('all'),
});

const defaultUserOnly = {
  preHandler: [
    async (request: FastifyRequest, reply: FastifyReply) => {
      const context = resolveRequestUserContext(request);
      if (context.userId !== getDefaultUserId()) {
        throw new AuthError('Only default user can access maintenance operations', 403, 'FORBIDDEN');
      }
    },
  ],
};

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get('/business-snapshot', defaultUserOnly, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await exportBusinessSnapshot();
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/business-snapshot', {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: '1 minute',
      },
    },
    ...defaultUserOnly,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
        timeWindow: '1 minute',
      },
    },
    ...defaultUserOnly,
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
