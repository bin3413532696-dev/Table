import { z } from 'zod';

export const providerFormatSchema = z.enum(['anthropic', 'openai', 'gemini', 'custom']);

export const providerIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createProviderSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  apiFormat: providerFormatSchema,
  baseUrl: z.string().trim().min(1).max(2000),
  apiKey: z.string().trim().max(4000).optional().default(''),
  model: z.string().trim().max(200).optional().default(''),
  headers: z.record(z.string(), z.string()).optional().default({}),
  isActive: z.boolean().optional().default(false),
});

export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  apiFormat: providerFormatSchema.optional(),
  baseUrl: z.string().trim().min(1).max(2000).optional(),
  apiKey: z.string().trim().max(4000).optional(),
  model: z.string().trim().max(200).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type ProviderFormat = z.infer<typeof providerFormatSchema>;
