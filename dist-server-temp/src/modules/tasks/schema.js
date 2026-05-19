"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTaskSchema = exports.createTaskSchema = exports.taskIdParamSchema = exports.taskPrioritySchema = void 0;
const zod_1 = require("zod");
exports.taskPrioritySchema = zod_1.z.enum(['low', 'medium', 'high']);
exports.taskIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.createTaskSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    completed: zod_1.z.boolean().optional(),
    priority: exports.taskPrioritySchema.default('medium'),
    dueDate: zod_1.z.string().trim().max(30).optional(),
    notes: zod_1.z.string().trim().max(5000).optional(),
});
exports.updateTaskSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200).optional(),
    priority: exports.taskPrioritySchema.optional(),
    dueDate: zod_1.z.string().trim().max(30).nullable().optional(),
    notes: zod_1.z.string().trim().max(5000).nullable().optional(),
    completed: zod_1.z.boolean().optional(),
    version: zod_1.z.number().int().min(1),
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
    message: 'At least one field must be provided',
});
