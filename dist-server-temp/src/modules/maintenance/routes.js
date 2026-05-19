"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceRoutes = maintenanceRoutes;
const zod_1 = require("zod");
const auth_1 = require("../../shared/auth");
const user_context_1 = require("../../shared/user-context");
const http_1 = require("../../shared/http");
const service_1 = require("./service");
const importSnapshotSchema = zod_1.z.object({
    version: zod_1.z.number().int().min(1).optional(),
    tasks: zod_1.z.array(zod_1.z.unknown()).max(10000).optional(),
    finance: zod_1.z.array(zod_1.z.unknown()).max(10000).optional(),
    knowledge: zod_1.z.object({
        notes: zod_1.z.array(zod_1.z.unknown()).max(10000).optional(),
        presetTags: zod_1.z.array(zod_1.z.unknown()).max(1000).optional(),
    }).optional(),
});
const resetScopeSchema = zod_1.z.object({
    scope: zod_1.z.enum(['all', 'tasks', 'finance', 'knowledge']).default('all'),
});
const defaultUserOnly = {
    preHandler: [
        async (request, reply) => {
            const context = (0, user_context_1.resolveRequestUserContext)(request);
            if (context.userId !== (0, user_context_1.getDefaultUserId)()) {
                throw new auth_1.AuthError('Only default user can access maintenance operations', 403, 'FORBIDDEN');
            }
        },
    ],
};
async function maintenanceRoutes(app) {
    app.get('/business-snapshot', defaultUserOnly, async (_request, reply) => {
        try {
            const result = await (0, service_1.exportBusinessSnapshot)();
            return reply.code(200).send(result);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/business-snapshot', {
        config: {
            rateLimit: {
                max: 1,
                timeWindow: '1 minute',
            },
        },
        ...defaultUserOnly,
    }, async (request, reply) => {
        try {
            const payload = importSnapshotSchema.parse(request.body);
            const result = await (0, service_1.importBusinessSnapshot)(payload);
            return reply.code(200).send(result);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    app.post('/reset', {
        config: {
            rateLimit: {
                max: 1,
                timeWindow: '1 minute',
            },
        },
        ...defaultUserOnly,
    }, async (request, reply) => {
        try {
            const payload = resetScopeSchema.parse(request.body ?? {});
            const result = await (0, service_1.resetWorkspaceData)(payload.scope);
            return reply.code(200).send(result);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
}
