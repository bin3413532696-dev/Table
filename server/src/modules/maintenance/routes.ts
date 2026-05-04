import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import { exportBusinessSnapshot, importBusinessSnapshot, resetWorkspaceData } from './service';

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
      const result = await importBusinessSnapshot(request.body);
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/reset', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await resetWorkspaceData();
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
