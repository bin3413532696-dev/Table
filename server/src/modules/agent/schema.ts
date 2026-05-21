import { z } from 'zod';

export const agentRunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_confirmation',
  'completed',
  'failed',
  'cancelled',
]);

export const agentSessionIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const agentRunIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const toolExecutionIdParamSchema = z.object({
  id: z.string().uuid(),
  toolExecutionId: z.string().min(1),
});

// Session schemas
export const listAgentSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createAgentSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional().default('新会话'),
});

export const updateAgentSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

// Run schemas
export const listAgentRunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sessionId: z.string().uuid().optional(),
  status: agentRunStatusSchema.optional(),
});

export const createAgentRunSchema = z.object({
  inputText: z.string().trim().min(1).max(20000),
  model: z.string().max(200).optional().default('default'), // 放宽验证，允许空字符串
  sessionId: z.string().uuid().optional(), // 可选，首次对话时后端自动创建
  systemPrompt: z.string().trim().max(5000).optional(), // 可选，临时覆盖用户默认人格
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
  version: z.number().int().min(1).optional(),
});

// Agent Persona schemas
export const agentPersonaSchema = z.object({
  systemPrompt: z.string().trim().max(5000).optional().default(''),
});

export const updateAgentPersonaSchema = agentPersonaSchema;

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ListAgentSessionsQuery = z.infer<typeof listAgentSessionsQuerySchema>;
export type CreateAgentSessionInput = z.infer<typeof createAgentSessionSchema>;
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;
export type UpdateAgentRunInput = z.infer<typeof updateAgentRunSchema>;
export type AgentPersonaInput = z.infer<typeof agentPersonaSchema>;
export type UpdateAgentPersonaInput = z.infer<typeof updateAgentPersonaSchema>;