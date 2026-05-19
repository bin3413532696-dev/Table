"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRoutes = agentRoutes;
const http_1 = require("../../shared/http");
const schema_1 = require("./schema");
const service_1 = require("./service");
async function agentRoutes(app) {
    const writeSseHeaders = (reply) => {
        reply.hijack();
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
    };
    app.get('/agent/health', async () => {
        const runtime = await (0, service_1.getAgentRuntimeStatus)();
        return {
            ok: runtime.connected,
            module: 'agent',
            stage: 'checkpointer-v1',
            runtime,
        };
    });
    app.get('/agent/runs', async (request, reply) => {
        try {
            const query = schema_1.listAgentRunsQuerySchema.parse(request.query);
            const result = await (0, service_1.getAgentRunList)(query);
            return {
                items: result.items,
                total: result.total,
                source: 'checkpoint',
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/agent/runs', async (request, reply) => {
        try {
            const payload = schema_1.createAgentRunSchema.parse(request.body);
            const run = await (0, service_1.createAgentRunRecord)(payload);
            return reply.code(201).send(run);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/agent/runs/stream', async (request, reply) => {
        let connectionClosed = false;
        const cleanup = () => {
            connectionClosed = true;
        };
        reply.raw.on('close', cleanup);
        try {
            const payload = schema_1.createAgentRunSchema.parse(request.body);
            writeSseHeaders(reply);
            const sendEvent = (event, data) => {
                if (connectionClosed) {
                    throw new Error('Client disconnected');
                }
                reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };
            const result = await (0, service_1.streamAgentRunRecord)(payload, (event) => {
                sendEvent(event.type, event);
            });
            if (!connectionClosed) {
                sendEvent('done', { ok: true, run: result });
                reply.raw.end();
            }
        }
        catch (error) {
            if (!reply.raw.headersSent) {
                reply.raw.off('close', cleanup);
                return (0, http_1.sendInfrastructureError)(reply, error);
            }
            if (!connectionClosed) {
                try {
                    reply.raw.write(`event: error\ndata: ${JSON.stringify({
                        message: error instanceof Error ? error.message : 'Unknown error',
                    })}\n\n`);
                    reply.raw.end();
                }
                catch {
                    // ignore write errors after disconnect
                }
            }
        }
        finally {
            reply.raw.off('close', cleanup);
        }
    });
    app.get('/agent/runs/:id', async (request, reply) => {
        try {
            const { id } = schema_1.agentRunIdParamSchema.parse(request.params);
            const run = await (0, service_1.getAgentRunDetail)(id);
            if (!run) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
            }
            return run;
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.delete('/agent/runs/:id', async (request, reply) => {
        try {
            const { id } = schema_1.agentRunIdParamSchema.parse(request.params);
            const result = await (0, service_1.deleteAgentRunRecord)(id);
            if (!result) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
            }
            return result;
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.patch('/agent/runs/:id', async (request, reply) => {
        try {
            const { id } = schema_1.agentRunIdParamSchema.parse(request.params);
            const payload = schema_1.updateAgentRunSchema.parse(request.body);
            const run = await (0, service_1.updateAgentRunRecord)(id, payload);
            if (!run) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run not found' });
            }
            return run;
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/agent/runs/:id/tools/:toolExecutionId/confirm', async (request, reply) => {
        try {
            const { id, toolExecutionId } = schema_1.toolExecutionIdParamSchema.parse(request.params);
            const run = await (0, service_1.confirmAgentRunTool)(id, toolExecutionId);
            if (!run) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run or tool execution not found' });
            }
            return run;
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/agent/runs/:id/tools/:toolExecutionId/confirm/stream', async (request, reply) => {
        let connectionClosed = false;
        const cleanup = () => {
            connectionClosed = true;
        };
        reply.raw.on('close', cleanup);
        try {
            const { id, toolExecutionId } = schema_1.toolExecutionIdParamSchema.parse(request.params);
            writeSseHeaders(reply);
            const sendEvent = (event, data) => {
                if (connectionClosed) {
                    throw new Error('Client disconnected');
                }
                reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };
            const result = await (0, service_1.streamConfirmAgentRunTool)(id, toolExecutionId, (event) => {
                sendEvent(event.type, event);
            });
            if (!connectionClosed) {
                sendEvent('done', { ok: true, run: result });
                reply.raw.end();
            }
        }
        catch (error) {
            if (!reply.raw.headersSent) {
                reply.raw.off('close', cleanup);
                return (0, http_1.sendInfrastructureError)(reply, error);
            }
            if (!connectionClosed) {
                try {
                    reply.raw.write(`event: error\ndata: ${JSON.stringify({
                        message: error instanceof Error ? error.message : 'Unknown error',
                    })}\n\n`);
                    reply.raw.end();
                }
                catch {
                    // ignore write errors after disconnect
                }
            }
        }
        finally {
            reply.raw.off('close', cleanup);
        }
    });
    app.post('/agent/runs/:id/tools/:toolExecutionId/reject', async (request, reply) => {
        try {
            const { id, toolExecutionId } = schema_1.toolExecutionIdParamSchema.parse(request.params);
            const run = await (0, service_1.rejectAgentRunTool)(id, toolExecutionId);
            if (!run) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent run or tool execution not found' });
            }
            return run;
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/agent/runs/:id/tools/:toolExecutionId/reject/stream', async (request, reply) => {
        let connectionClosed = false;
        const cleanup = () => {
            connectionClosed = true;
        };
        reply.raw.on('close', cleanup);
        try {
            const { id, toolExecutionId } = schema_1.toolExecutionIdParamSchema.parse(request.params);
            writeSseHeaders(reply);
            const sendEvent = (event, data) => {
                if (connectionClosed) {
                    throw new Error('Client disconnected');
                }
                reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };
            const result = await (0, service_1.streamRejectAgentRunTool)(id, toolExecutionId, (event) => {
                sendEvent(event.type, event);
            });
            if (!connectionClosed) {
                sendEvent('done', { ok: true, run: result });
                reply.raw.end();
            }
        }
        catch (error) {
            if (!reply.raw.headersSent) {
                reply.raw.off('close', cleanup);
                return (0, http_1.sendInfrastructureError)(reply, error);
            }
            if (!connectionClosed) {
                try {
                    reply.raw.write(`event: error\ndata: ${JSON.stringify({
                        message: error instanceof Error ? error.message : 'Unknown error',
                    })}\n\n`);
                    reply.raw.end();
                }
                catch {
                    // ignore write errors after disconnect
                }
            }
        }
        finally {
            reply.raw.off('close', cleanup);
        }
    });
}
