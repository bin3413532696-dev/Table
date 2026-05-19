import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import {
  agentRunIdParamSchema,
  createAgentRunSchema,
  listAgentRunsQuerySchema,
  toolExecutionIdParamSchema,
  updateAgentRunSchema,
} from './schema';
import {
  confirmAgentRunTool,
  createAgentRunRecord,
  getAgentRuntimeStatus,
  getAgentRunDetail,
  getAgentRunList,
  rejectAgentRunTool,
  streamAgentRunRecord,
  streamConfirmAgentRunTool,
  streamRejectAgentRunTool,
  updateAgentRunRecord,
  deleteAgentRunRecord,
} from './service';

export async function agentRoutes(app: FastifyInstance) {
  const writeSseHeaders = (reply: FastifyReply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  };

  app.get('/agent/health', async () => {
    const runtime = await getAgentRuntimeStatus();
    return {
      ok: runtime.connected,
      module: 'agent',
      stage: 'checkpointer-v1',
      runtime,
    };
  });

  app.get('/agent/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listAgentRunsQuerySchema.parse(request.query);
      const result = await getAgentRunList(query);
      return {
        items: result.items,
        total: result.total,
        source: 'checkpoint',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createAgentRunSchema.parse(request.body);
      const run = await createAgentRunRecord(payload);
      return reply.code(201).send(run);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/runs/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    let connectionClosed = false;

    const cleanup = () => {
      connectionClosed = true;
    };
    reply.raw.on('close', cleanup);

    try {
      const payload = createAgentRunSchema.parse(request.body);

      writeSseHeaders(reply);

      const sendEvent = (event: string, data: unknown) => {
        if (connectionClosed) {
          throw new Error('Client disconnected');
        }
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await streamAgentRunRecord(payload, (event) => {
        sendEvent((event as { type: string }).type, event);
      });

      if (!connectionClosed) {
        sendEvent('done', { ok: true, run: result });
        reply.raw.end();
      }
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.raw.off('close', cleanup);
        return sendInfrastructureError(reply, error);
      }

      if (!connectionClosed) {
        try {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`);
          reply.raw.end();
        } catch {
          // ignore write errors after disconnect
        }
      }
    } finally {
      reply.raw.off('close', cleanup);
    }
  });

  app.get('/agent/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentRunIdParamSchema.parse(request.params);
      const run = await getAgentRunDetail(id);
      if (!run) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
      }
      return run;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/agent/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentRunIdParamSchema.parse(request.params);
      const result = await deleteAgentRunRecord(id);
      if (!result) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
      }
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/agent/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentRunIdParamSchema.parse(request.params);
      const payload = updateAgentRunSchema.parse(request.body);
      const run = await updateAgentRunRecord(id, payload);
      if (!run) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
      }
      return run;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/runs/:id/tools/:toolExecutionId/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);
      const run = await confirmAgentRunTool(id, toolExecutionId);
      if (!run) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run or tool execution not found' });
      }
      return run;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/runs/:id/tools/:toolExecutionId/confirm/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    let connectionClosed = false;

    const cleanup = () => {
      connectionClosed = true;
    };
    reply.raw.on('close', cleanup);

    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);

      writeSseHeaders(reply);

      const sendEvent = (event: string, data: unknown) => {
        if (connectionClosed) {
          throw new Error('Client disconnected');
        }
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await streamConfirmAgentRunTool(id, toolExecutionId, (event) => {
        sendEvent((event as { type: string }).type, event);
      });

      if (!connectionClosed) {
        sendEvent('done', { ok: true, run: result });
        reply.raw.end();
      }
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.raw.off('close', cleanup);
        return sendInfrastructureError(reply, error);
      }

      if (!connectionClosed) {
        try {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`);
          reply.raw.end();
        } catch {
          // ignore write errors after disconnect
        }
      }
    } finally {
      reply.raw.off('close', cleanup);
    }
  });

  app.post('/agent/runs/:id/tools/:toolExecutionId/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);
      const run = await rejectAgentRunTool(id, toolExecutionId);
      if (!run) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run or tool execution not found' });
      }
      return run;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/runs/:id/tools/:toolExecutionId/reject/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    let connectionClosed = false;

    const cleanup = () => {
      connectionClosed = true;
    };
    reply.raw.on('close', cleanup);

    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);

      writeSseHeaders(reply);

      const sendEvent = (event: string, data: unknown) => {
        if (connectionClosed) {
          throw new Error('Client disconnected');
        }
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await streamRejectAgentRunTool(id, toolExecutionId, (event) => {
        sendEvent((event as { type: string }).type, event);
      });

      if (!connectionClosed) {
        sendEvent('done', { ok: true, run: result });
        reply.raw.end();
      }
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.raw.off('close', cleanup);
        return sendInfrastructureError(reply, error);
      }

      if (!connectionClosed) {
        try {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`);
          reply.raw.end();
        } catch {
          // ignore write errors after disconnect
        }
      }
    } finally {
      reply.raw.off('close', cleanup);
    }
  });
}
