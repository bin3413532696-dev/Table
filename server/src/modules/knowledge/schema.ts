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

export const knowledgeDatasetBodySchema = z.object({
  dataset: z.unknown(),
});

export const knowledgeIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const knowledgeRelationParamSchema = z.object({
  subjectId: z.string().trim().min(1),
  predicateId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});

export const knowledgeSearchQuerySchema = z.object({
  query: z.string().trim().optional().default(''),
  typeIds: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  tags: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  includeDocuments: queryBooleanSchema.optional().default(true),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
});

export const upsertOntologyClassSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().optional(),
  parentIds: z.array(z.string().trim().min(1)).optional(),
});

export const updateOntologyClassSchema = z.object({
  label: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  parentIds: z.array(z.string().trim().min(1)).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const upsertOntologyRelationSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().optional(),
  inverseId: z.string().trim().min(1).optional(),
  symmetric: z.boolean().optional(),
  transitive: z.boolean().optional(),
});

export const updateOntologyRelationSchema = z.object({
  label: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  inverseId: z.string().trim().min(1).nullable().optional(),
  symmetric: z.boolean().optional(),
  transitive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

const knowledgeScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const knowledgeAttributeValueSchema: z.ZodType<
  string | number | boolean | null | Array<string | number | boolean | null> | Record<string, string | number | boolean | null>
> = z.union([
  knowledgeScalarSchema,
  z.array(knowledgeScalarSchema),
  z.record(knowledgeScalarSchema),
]);

export const upsertKnowledgeEntitySchema = z.object({
  id: z.string().trim().min(1).optional(),
  typeId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  aliases: z.array(z.string().trim()).optional(),
  tags: z.array(z.string().trim()).optional(),
  attributes: z.record(knowledgeAttributeValueSchema).optional(),
  source: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const updateKnowledgeEntitySchema = z.object({
  typeId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  summary: z.string().optional(),
  aliases: z.array(z.string().trim()).optional(),
  tags: z.array(z.string().trim()).optional(),
  attributes: z.record(knowledgeAttributeValueSchema).optional(),
  source: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const upsertKnowledgeDocumentSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string().trim()).optional(),
  entityIds: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
});

export const updateKnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string().trim()).optional(),
  entityIds: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const upsertKnowledgeAssertionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  subjectId: z.string().trim().min(1),
  predicateId: z.string().trim().min(1),
  objectId: z.string().trim().min(1).optional(),
  value: knowledgeScalarSchema.optional(),
  evidenceDocumentIds: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).refine((value) => value.objectId || value.value !== undefined, {
  message: 'At least one of objectId or value must be provided',
});

export const updateKnowledgeAssertionSchema = z.object({
  subjectId: z.string().trim().min(1).optional(),
  predicateId: z.string().trim().min(1).optional(),
  objectId: z.string().trim().min(1).optional(),
  value: knowledgeScalarSchema.optional(),
  evidenceDocumentIds: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const createKnowledgeRelationSchema = z.object({
  subjectId: z.string().trim().min(1),
  predicateId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  source: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type KnowledgeDatasetBodyInput = z.infer<typeof knowledgeDatasetBodySchema>;
export type KnowledgeSearchQueryInput = z.infer<typeof knowledgeSearchQuerySchema>;
export type UpsertKnowledgeEntityInput = z.infer<typeof upsertKnowledgeEntitySchema>;
export type UpsertKnowledgeDocumentInput = z.infer<typeof upsertKnowledgeDocumentSchema>;
export type UpsertKnowledgeAssertionInput = z.infer<typeof upsertKnowledgeAssertionSchema>;
export type CreateKnowledgeRelationInput = z.infer<typeof createKnowledgeRelationSchema>;
export type UpsertOntologyClassInput = z.infer<typeof upsertOntologyClassSchema>;
export type UpsertOntologyRelationInput = z.infer<typeof upsertOntologyRelationSchema>;
