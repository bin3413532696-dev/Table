"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAgentRunSchema = exports.createAgentRunSchema = exports.listAgentRunsQuerySchema = exports.toolExecutionIdParamSchema = exports.agentRunIdParamSchema = exports.agentRunStatusSchema = void 0;
const zod_1 = require("zod");
exports.agentRunStatusSchema = zod_1.z.enum([
    'pending',
    'running',
    'waiting_confirmation',
    'completed',
    'failed',
    'cancelled',
]);
exports.agentRunIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.toolExecutionIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    toolExecutionId: zod_1.z.string().min(1),
});
exports.listAgentRunsQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().positive().max(50).optional().default(20),
    offset: zod_1.z.coerce.number().int().min(0).optional().default(0),
    status: exports.agentRunStatusSchema.optional(),
});
exports.createAgentRunSchema = zod_1.z.object({
    inputText: zod_1.z.string().trim().min(1).max(20000),
    model: zod_1.z.string().trim().min(1).max(200).optional().default('default'),
    sessionId: zod_1.z.string().uuid().optional(),
    initialMessages: zod_1.z
        .array(zod_1.z.object({
        role: zod_1.z.enum(['system', 'user', 'assistant', 'tool']),
        content: zod_1.z.string().trim().min(1).max(20000),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    }))
        .optional()
        .default([]),
});
exports.updateAgentRunSchema = zod_1.z.object({
    status: exports.agentRunStatusSchema.optional(),
});
