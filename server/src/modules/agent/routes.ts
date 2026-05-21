import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import {
  agentRunIdParamSchema,
  agentSessionIdParamSchema,
  createAgentRunSchema,
  createAgentSessionSchema,
  listAgentRunsQuerySchema,
  listAgentSessionsQuerySchema,
  toolExecutionIdParamSchema,
  updateAgentRunSchema,
  updateAgentSessionSchema,
  updateAgentPersonaSchema,
} from './schema';
import {
  confirmAgentRunTool,
  createAgentRunRecord,
  createAgentSessionRecord,
  deleteAgentRunRecord,
  deleteAgentSessionRecord,
  getAgentRuntimeStatus,
  getAgentRunDetail,
  getAgentRunList,
  getAgentSessionDetail,
  getAgentSessionList,
  rejectAgentRunTool,
  streamAgentRunRecord,
  streamConfirmAgentRunTool,
  streamRejectAgentRunTool,
  updateAgentRunRecord,
  updateAgentSessionRecord,
  getAgentPersona,
  updateAgentPersona,
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

  // Health check
  app.get('/agent/health', async () => {
    const runtime = await getAgentRuntimeStatus();
    return {
      ok: runtime.connected,
      module: 'agent',
      stage: 'checkpointer-v1',
      runtime,
    };
  });

  // ============ Persona Routes ============

  app.get('/agent/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const persona = await getAgentPersona();
      return persona;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.put('/agent/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = updateAgentPersonaSchema.parse(request.body);
      const persona = await updateAgentPersona(payload);
      return persona;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // ============ Session Routes ============

  app.get('/agent/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listAgentSessionsQuerySchema.parse(request.query);
      const result = await getAgentSessionList(query);
      return {
        items: result.items,
        total: result.total,
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/agent/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentSessionIdParamSchema.parse(request.params);
      const session = await getAgentSessionDetail(id);
      if (!session) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' });
      }
      return session;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/agent/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createAgentSessionSchema.parse(request.body);
      const session = await createAgentSessionRecord(payload);
      return reply.code(201).send(session);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/agent/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentSessionIdParamSchema.parse(request.params);
      const payload = updateAgentSessionSchema.parse(request.body);
      const session = await updateAgentSessionRecord(id, payload);
      if (!session) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' });
      }
      return session;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/agent/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = agentSessionIdParamSchema.parse(request.params);
      const result = await deleteAgentSessionRecord(id);
      if (!result) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // ============ Run Routes ============

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
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let responseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      connectionClosed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (responseTimeoutTimer) {
        clearTimeout(responseTimeoutTimer);
        responseTimeoutTimer = null;
      }
    };
    reply.raw.on('close', cleanup);

    try {
      const payload = createAgentRunSchema.parse(request.body);

      writeSseHeaders(reply);

      // SSE 心跳：每 25 秒发送一次注释，保持连接活跃
      // Nginx 默认 keepalive_timeout 为 60s，客户端可据此调整
      heartbeatTimer = setInterval(() => {
        if (!connectionClosed) {
          try {
            reply.raw.write(`: heartbeat\n\n`);
          } catch {
            cleanup();
          }
        }
      }, 25000);

      // SSE 总超时：5 分钟无响应则强制关闭
      // 与前端 AbortController 120s 超时配合
      const SSE_TIMEOUT_MS = 5 * 60 * 1000;
      responseTimeoutTimer = setTimeout(() => {
        if (!connectionClosed) {
          cleanup();
          try {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'SSE response timeout' })}\n\n`);
            reply.raw.end();
          } catch {
            // ignore
          }
        }
      }, SSE_TIMEOUT_MS);

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
      cleanup();
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
      if (error instanceof Error && error.message.includes('无法删除运行中的会话')) {
        return reply.code(409).send({ error: 'CONFLICT', message: error.message });
      }
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
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let responseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      connectionClosed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (responseTimeoutTimer) {
        clearTimeout(responseTimeoutTimer);
        responseTimeoutTimer = null;
      }
    };
    reply.raw.on('close', cleanup);

    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);

      writeSseHeaders(reply);

      // SSE 心跳
      heartbeatTimer = setInterval(() => {
        if (!connectionClosed) {
          try {
            reply.raw.write(`: heartbeat\n\n`);
          } catch {
            cleanup();
          }
        }
      }, 25000);

      // SSE 总超时：5 分钟
      responseTimeoutTimer = setTimeout(() => {
        if (!connectionClosed) {
          cleanup();
          try {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'SSE response timeout' })}\n\n`);
            reply.raw.end();
          } catch {
            // ignore
          }
        }
      }, 5 * 60 * 1000);

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
      cleanup();
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
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let responseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      connectionClosed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (responseTimeoutTimer) {
        clearTimeout(responseTimeoutTimer);
        responseTimeoutTimer = null;
      }
    };
    reply.raw.on('close', cleanup);

    try {
      const { id, toolExecutionId } = toolExecutionIdParamSchema.parse(request.params);

      writeSseHeaders(reply);

      // SSE 心跳
      heartbeatTimer = setInterval(() => {
        if (!connectionClosed) {
          try {
            reply.raw.write(`: heartbeat\n\n`);
          } catch {
            cleanup();
          }
        }
      }, 25000);

      // SSE 总超时：5 分钟
      responseTimeoutTimer = setTimeout(() => {
        if (!connectionClosed) {
          cleanup();
          try {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'SSE response timeout' })}\n\n`);
            reply.raw.end();
          } catch {
            // ignore
          }
        }
      }, 5 * 60 * 1000);

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
      cleanup();
      reply.raw.off('close', cleanup);
    }
  });
}