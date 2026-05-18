import { z } from 'zod';

export const agentRunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_confirmation',
  'completed',
  'failed',
  'cancelled',
]);

export const agentRunIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const toolExecutionIdParamSchema = z.object({
  id: z.string().uuid(),
  toolExecutionId: z.string().min(1),
});

export const listAgentRunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: agentRunStatusSchema.optional(),
});

export const createAgentRunSchema = z.object({
  inputText: z.string().trim().min(1).max(20000),
  model: z.string().trim().min(1).max(200).optional().default('default'),
  sessionId: z.string().uuid().optional(),
  initialMessages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string().trim().min(1).max(20000),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional()
    .default([]),
});

export const updateAgentRunSchema = z.object({
  status: agentRunStatusSchema.optional(),
});

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;
export type UpdateAgentRunInput = z.infer<typeof updateAgentRunSchema>;
