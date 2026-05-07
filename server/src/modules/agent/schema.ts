import { z } from 'zod';

export const agentProviderSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  apiFormat: z.enum(['anthropic', 'openai', 'gemini', 'custom']),
  baseUrl: z.string().trim().min(1).max(2000),
  apiKey: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(200).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const agentRunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_confirmation',
  'completed',
  'failed',
  'cancelled',
]);

export const toolExecutionStatusSchema = z.enum([
  'pending',
  'waiting_confirmation',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const agentRunIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const toolExecutionIdParamSchema = z.object({
  id: z.string().uuid(),
  toolExecutionId: z.string().uuid(),
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
  provider: agentProviderSchema.optional(),
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

export const appendAgentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().trim().min(1).max(20000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateAgentRunSchema = z.object({
  status: agentRunStatusSchema.optional(),
  requiresConfirmation: z.boolean().optional(),
  errorMessage: z.string().max(20000).nullable().optional(),
  finishedAt: z.union([z.coerce.date(), z.null()]).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
});

export const createToolExecutionSchema = z.object({
  toolName: z.string().trim().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
  status: toolExecutionStatusSchema.optional().default('pending'),
  requiresConfirmation: z.boolean().optional().default(false),
  confirmationRequestedAt: z.coerce.date().optional(),
  confirmedAt: z.coerce.date().optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  errorMessage: z.string().max(20000).nullable().optional(),
});

export const confirmToolExecutionSchema = z.object({
  provider: agentProviderSchema.optional(),
}).optional().default({});

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ToolExecutionStatus = z.infer<typeof toolExecutionStatusSchema>;
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;
export type AppendAgentMessageInput = z.infer<typeof appendAgentMessageSchema>;
export type UpdateAgentRunInput = z.infer<typeof updateAgentRunSchema>;
export type CreateToolExecutionInput = z.infer<typeof createToolExecutionSchema>;
export type ConfirmToolExecutionInput = z.infer<typeof confirmToolExecutionSchema>;
export type AgentProviderInput = z.infer<typeof agentProviderSchema>;
