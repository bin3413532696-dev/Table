"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFinanceRecordSchema = exports.createFinanceRecordSchema = exports.financeIdParamSchema = exports.financeTypeSchema = void 0;
const zod_1 = require("zod");
// ISO 日期格式校验：YYYY-MM-DD
const dateStringSchema = zod_1.z.string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
}, 'Invalid date value');
exports.financeTypeSchema = zod_1.z.enum(['income', 'expense']);
exports.financeIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.createFinanceRecordSchema = zod_1.z.object({
    type: exports.financeTypeSchema,
    amount: zod_1.z.number().nonnegative().max(999999999.99),
    category: zod_1.z.string().trim().min(1).max(100),
    description: zod_1.z.string().trim().min(1).max(500),
    date: dateStringSchema.optional(),
    recordDate: dateStringSchema.optional(),
    model: zod_1.z.string().trim().max(100).nullable().optional(),
}).refine((value) => Boolean(value.date || value.recordDate), {
    message: 'date or recordDate is required',
    path: ['date'],
});
exports.updateFinanceRecordSchema = zod_1.z.object({
    type: exports.financeTypeSchema.optional(),
    amount: zod_1.z.number().nonnegative().max(999999999.99).optional(),
    category: zod_1.z.string().trim().min(1).max(100).optional(),
    description: zod_1.z.string().trim().min(1).max(500).optional(),
    date: dateStringSchema.optional(),
    recordDate: dateStringSchema.optional(),
    model: zod_1.z.string().trim().max(100).nullable().optional(),
    version: zod_1.z.number().int().min(1),
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
    message: 'At least one field must be provided',
});
