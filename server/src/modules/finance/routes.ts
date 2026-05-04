import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createFinanceRecordSchema,
  financeIdParamSchema,
  updateFinanceRecordSchema,
} from './schema';
import { sendInfrastructureError } from '../../shared/http';
import {
  createFinanceRecordEntry,
  deleteFinanceRecordEntry,
  getFinanceList,
  getFinanceRecordDetail,
  updateFinanceRecordEntry,
} from './service';

export async function financeRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    try {
      const items = await getFinanceList();
      return {
        items,
        total: items.length,
        source: 'postgres',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createFinanceRecordSchema.parse(request.body);
      const record = await createFinanceRecordEntry(payload);
      return reply.code(201).send(record);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = financeIdParamSchema.parse(request.params);
      const record = await getFinanceRecordDetail(id);
      if (!record) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
      }
      return record;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = financeIdParamSchema.parse(request.params);
      const payload = updateFinanceRecordSchema.parse(request.body);
      const record = await updateFinanceRecordEntry(id, payload);
      if (!record) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
      }
      return record;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = financeIdParamSchema.parse(request.params);
      const record = await deleteFinanceRecordEntry(id);
      if (!record) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
