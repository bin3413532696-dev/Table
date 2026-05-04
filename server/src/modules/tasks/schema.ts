import { z } from 'zod';

export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
export const taskIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  completed: z.boolean().optional(),
  priority: taskPrioritySchema.default('medium'),
  dueDate: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  completed: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
