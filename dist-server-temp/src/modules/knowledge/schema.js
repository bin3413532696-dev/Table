"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePresetTagSchema = exports.createPresetTagSchema = exports.noteSearchQuerySchema = exports.updateNoteSchema = exports.createNoteSchema = exports.presetTagIdParamSchema = exports.noteIdParamSchema = void 0;
const zod_1 = require("zod");
exports.noteIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.presetTagIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.createNoteSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    content: zod_1.z.string().max(50000).optional().default(''),
    tags: zod_1.z.array(zod_1.z.string().trim().max(50)).max(20).optional().default([]),
});
exports.updateNoteSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200).optional(),
    content: zod_1.z.string().max(50000).optional(),
    tags: zod_1.z.array(zod_1.z.string().trim().max(50)).max(20).optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});
exports.noteSearchQuerySchema = zod_1.z.object({
    query: zod_1.z.string().trim().max(200).optional().default(''),
    tags: zod_1.z.union([zod_1.z.string().trim().max(50), zod_1.z.array(zod_1.z.string().trim().max(50)).max(20)]).optional(),
    limit: zod_1.z.coerce.number().int().positive().max(50).optional().default(20),
    offset: zod_1.z.coerce.number().int().min(0).max(100000).optional().default(0),
});
exports.createPresetTagSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(50),
    color: zod_1.z.string().trim().max(7).optional().default('#6B7280'),
});
exports.updatePresetTagSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(50).optional(),
    color: zod_1.z.string().trim().max(7).optional(),
    sortOrder: zod_1.z.number().int().min(0).max(9999).optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});
