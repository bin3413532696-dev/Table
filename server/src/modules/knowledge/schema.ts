import { z } from 'zod';

export const noteIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const presetTagIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createNoteSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().optional().default(''),
  tags: z.array(z.string().trim()).optional().default([]),
});

export const updateNoteSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().optional(),
  tags: z.array(z.string().trim()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const noteSearchQuerySchema = z.object({
  query: z.string().trim().optional().default(''),
  tags: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createPresetTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().trim().optional().default('#6B7280'),
});

export const updatePresetTagSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().trim().optional(),
  sortOrder: z.number().int().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type NoteSearchQueryInput = z.infer<typeof noteSearchQuerySchema>;
export type CreatePresetTagInput = z.infer<typeof createPresetTagSchema>;
export type UpdatePresetTagInput = z.infer<typeof updatePresetTagSchema>;