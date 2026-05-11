import { z } from 'zod';

// ISO 日期格式校验：YYYY-MM-DD
const dateStringSchema = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date value');

export const financeTypeSchema = z.enum(['income', 'expense']);
export const financeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createFinanceRecordSchema = z.object({
  type: financeTypeSchema,
  amount: z.number().nonnegative().max(999999999.99),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  date: dateStringSchema.optional(),
  recordDate: dateStringSchema.optional(),
  model: z.string().trim().max(100).nullable().optional(),
}).refine((value) => Boolean(value.date || value.recordDate), {
  message: 'date or recordDate is required',
  path: ['date'],
});

export const updateFinanceRecordSchema = z.object({
  type: financeTypeSchema.optional(),
  amount: z.number().nonnegative().max(999999999.99).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  date: dateStringSchema.optional(),
  recordDate: dateStringSchema.optional(),
  model: z.string().trim().max(100).nullable().optional(),
  version: z.number().int().min(1).optional(),
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
  message: 'At least one field must be provided',
});

export type CreateFinanceRecordInput = z.infer<typeof createFinanceRecordSchema>;
export type UpdateFinanceRecordInput = z.infer<typeof updateFinanceRecordSchema>;
