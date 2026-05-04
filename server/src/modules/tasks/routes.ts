import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createTaskSchema, taskIdParamSchema, updateTaskSchema } from './schema';
import { sendInfrastructureError } from '../../shared/http';
import {
  createTaskRecord,
  deleteTaskRecord,
  getTaskDetail,
  getTaskList,
  updateTaskRecord,
} from './service';

export async function taskRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    try {
      const items = await getTaskList();
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
      const payload = createTaskSchema.parse(request.body);
      const task = await createTaskRecord(payload);
      return reply.code(201).send(task);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = taskIdParamSchema.parse(request.params);
      const task = await getTaskDetail(id);
      if (!task) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
      }
      return task;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = taskIdParamSchema.parse(request.params);
      const payload = updateTaskSchema.parse(request.body);
      const task = await updateTaskRecord(id, payload);
      if (!task) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
      }
      return task;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = taskIdParamSchema.parse(request.params);
      const task = await deleteTaskRecord(id);
      if (!task) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
