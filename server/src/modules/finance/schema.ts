import { z } from 'zod';

export const financeTypeSchema = z.enum(['income', 'expense']);
export const financeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createFinanceRecordSchema = z.object({
  type: financeTypeSchema,
  amount: z.number().nonnegative(),
  category: z.string().trim().min(1),
  description: z.string().trim().min(1),
  date: z.string().trim().min(1).optional(),
  recordDate: z.string().trim().min(1).optional(),
  model: z.string().trim().nullable().optional(),
}).refine((value) => Boolean(value.date || value.recordDate), {
  message: 'date or recordDate is required',
  path: ['date'],
});

export const updateFinanceRecordSchema = z.object({
  type: financeTypeSchema.optional(),
  amount: z.number().nonnegative().optional(),
  category: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  date: z.string().trim().optional(),
  recordDate: z.string().trim().optional(),
  model: z.string().trim().nullable().optional(),
  version: z.number().int().optional(),
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
  message: 'At least one field must be provided',
});

export type CreateFinanceRecordInput = z.infer<typeof createFinanceRecordSchema>;
export type UpdateFinanceRecordInput = z.infer<typeof updateFinanceRecordSchema>;
