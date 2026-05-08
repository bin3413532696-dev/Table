import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
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

  app.post('/reset', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = resetScopeSchema.parse(request.body ?? {});
      const result = await resetWorkspaceData(payload.scope);
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
