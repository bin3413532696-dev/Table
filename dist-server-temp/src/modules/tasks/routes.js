"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskRoutes = taskRoutes;
const schema_1 = require("./schema");
const http_1 = require("../../shared/http");
const service_1 = require("./service");
async function taskRoutes(app) {
    app.get('/', async (_request, reply) => {
        try {
            const items = await (0, service_1.getTaskList)();
            return {
                items,
                total: items.length,
                source: 'postgres',
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/', async (request, reply) => {
        try {
            const payload = schema_1.createTaskSchema.parse(request.body);
            const task = await (0, service_1.createTaskRecord)(payload);
            return reply.code(201).send({ data: task, source: 'postgres' });
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.get('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.taskIdParamSchema.parse(request.params);
            const task = await (0, service_1.getTaskDetail)(id);
            if (!task) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
            }
            return { data: task, source: 'postgres' };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.patch('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.taskIdParamSchema.parse(request.params);
            const payload = schema_1.updateTaskSchema.parse(request.body);
            const task = await (0, service_1.updateTaskRecord)(id, payload);
            if (!task) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
            }
            return { data: task, source: 'postgres' };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.delete('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.taskIdParamSchema.parse(request.params);
            const task = await (0, service_1.deleteTaskRecord)(id);
            if (!task) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
            }
            return reply.code(204).send();
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
}
