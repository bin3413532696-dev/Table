import { z } from 'zod';

export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
export const taskIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  completed: z.boolean().optional(),
  priority: taskPrioritySchema.default('medium'),
  dueDate: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  completed: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
  message: 'At least one field must be provided',
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
