"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.financeRoutes = financeRoutes;
const schema_1 = require("./schema");
const http_1 = require("../../shared/http");
const service_1 = require("./service");
async function financeRoutes(app) {
    app.get('/', async (_request, reply) => {
        try {
            const items = await (0, service_1.getFinanceList)();
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
            const payload = schema_1.createFinanceRecordSchema.parse(request.body);
            const record = await (0, service_1.createFinanceRecordEntry)(payload);
            return reply.code(201).send({ data: record, source: 'postgres' });
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.get('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.financeIdParamSchema.parse(request.params);
            const record = await (0, service_1.getFinanceRecordDetail)(id);
            if (!record) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
            }
            return { data: record, source: 'postgres' };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.patch('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.financeIdParamSchema.parse(request.params);
            const payload = schema_1.updateFinanceRecordSchema.parse(request.body);
            const record = await (0, service_1.updateFinanceRecordEntry)(id, payload);
            if (!record) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
            }
            return { data: record, source: 'postgres' };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.delete('/:id', async (request, reply) => {
        try {
            const { id } = schema_1.financeIdParamSchema.parse(request.params);
            const record = await (0, service_1.deleteFinanceRecordEntry)(id);
            if (!record) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Finance record not found' });
            }
            return reply.code(204).send();
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
}
