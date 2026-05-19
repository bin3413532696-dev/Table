"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRoutes = providerRoutes;
const http_1 = require("../../shared/http");
const schema_1 = require("./schema");
const service_1 = require("./service");
async function providerRoutes(app) {
    app.get('/providers', async (_request, reply) => {
        try {
            const items = await (0, service_1.listProvidersForCurrentUser)();
            return {
                data: {
                    items,
                    total: items.length,
                },
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.get('/providers/active', async (_request, reply) => {
        try {
            const provider = await (0, service_1.getActiveProviderForCurrentUser)();
            return {
                data: {
                    provider,
                },
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/providers', async (request, reply) => {
        try {
            const payload = schema_1.createProviderSchema.parse(request.body);
            const provider = await (0, service_1.createProviderForCurrentUser)(payload);
            return reply.code(201).send({
                data: {
                    provider,
                },
            });
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.patch('/providers/:id', async (request, reply) => {
        try {
            const { id } = schema_1.providerIdParamSchema.parse(request.params);
            const payload = schema_1.updateProviderSchema.parse(request.body);
            const provider = await (0, service_1.updateProviderForCurrentUser)(id, payload);
            if (!provider) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
            }
            return {
                data: {
                    provider,
                },
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.delete('/providers/:id', async (request, reply) => {
        try {
            const { id } = schema_1.providerIdParamSchema.parse(request.params);
            const result = await (0, service_1.deleteProviderForCurrentUser)(id);
            if (!result) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
            }
            return {
                data: result,
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/providers/:id/activate', async (request, reply) => {
        try {
            const { id } = schema_1.providerIdParamSchema.parse(request.params);
            const provider = await (0, service_1.activateProviderForCurrentUser)(id);
            if (!provider) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider not found' });
            }
            return {
                data: {
                    provider,
                },
            };
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
}
