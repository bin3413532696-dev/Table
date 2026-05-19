"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProviderSchema = exports.createProviderSchema = exports.providerIdParamSchema = exports.providerFormatSchema = void 0;
const zod_1 = require("zod");
exports.providerFormatSchema = zod_1.z.enum(['anthropic', 'openai', 'gemini', 'custom']);
exports.providerIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.createProviderSchema = zod_1.z.object({
    id: zod_1.z.string().uuid().optional(),
    name: zod_1.z.string().trim().min(1).max(200),
    apiFormat: exports.providerFormatSchema,
    baseUrl: zod_1.z.string().trim().min(1).max(2000),
    apiKey: zod_1.z.string().trim().max(4000).optional().default(''),
    model: zod_1.z.string().trim().max(200).optional().default(''),
    headers: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional().default({}),
    isActive: zod_1.z.boolean().optional().default(false),
    source: zod_1.z.enum(['bootstrap', 'manual']).optional().default('manual'),
});
exports.updateProviderSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(200).optional(),
    apiFormat: exports.providerFormatSchema.optional(),
    baseUrl: zod_1.z.string().trim().min(1).max(2000).optional(),
    apiKey: zod_1.z.string().trim().max(4000).optional(),
    model: zod_1.z.string().trim().max(200).optional(),
    headers: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(),
    isActive: zod_1.z.boolean().optional(),
    version: zod_1.z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});
