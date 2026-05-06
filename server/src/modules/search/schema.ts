import { z } from 'zod';

const queryBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

const searchModuleSchema = z.enum(['task', 'finance', 'knowledge']);

export const unifiedSearchQuerySchema = z.object({
  query: z.string().trim().optional().default(''),
  modules: z.union([searchModuleSchema, z.array(searchModuleSchema)]).optional(),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  includeKnowledgeDocuments: queryBooleanSchema.optional().default(true),
  knowledgeTypeIds: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  knowledgeTags: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
});

export type UnifiedSearchQueryInput = z.infer<typeof unifiedSearchQuerySchema>;

