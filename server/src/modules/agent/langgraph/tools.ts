import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listTasks } from '../../tasks/repository';
import { toTaskDto } from '../../tasks/dto';
import { listFinanceRecords, createFinanceRecord } from '../../finance/repository';
import { toFinanceRecordDto } from '../../finance/dto';
import { searchNotes } from '../../knowledge/repository';
import { createTask, findTaskById, updateTask, softDeleteTask } from '../../tasks/repository';

/**
 * 工具定义 - 使用 LangChain Tool 接口
 * 所有工具保留 requiresConfirmation 元数据
 */

// ============ 查询类工具（无需确认） ============

export const queryTasksTool = tool(
  async ({ completed, priority, limit }) => {
    const tasks = await listTasks();
    return tasks
      .filter((task) => completed === undefined || task.completed === completed)
      .filter((task) => !priority || task.priority === priority)
      .slice(0, limit || 20)
      .map(toTaskDto);
  },
  {
    name: 'query_tasks',
    description: '查询任务列表，可按完成状态和优先级筛选',
    schema: z.object({
      completed: z.boolean().optional().describe('是否已完成'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级'),
      limit: z.number().max(100).default(20).describe('返回数量限制'),
    }),
  }
);

export const getTaskStatsTool = tool(
  async () => {
    const tasks = await listTasks();
    const completed = tasks.filter((task) => task.completed).length;
    const overdue = tasks.filter((task) => {
      if (!task.dueDate || task.completed) return false;
      return task.dueDate.getTime() < Date.now();
    }).length;
    return {
      total: tasks.length,
      completed,
      pending: tasks.length - completed,
      overdue,
    };
  },
  {
    name: 'get_task_stats',
    description: '获取任务统计数据',
    schema: z.object({}),
  }
);

export const queryFinanceTool = tool(
  async ({ type, category, startDate, endDate, limit }) => {
    const records = await listFinanceRecords();
    let filtered = records;

    if (type && type !== 'all') {
      filtered = filtered.filter((r) => r.type === type);
    }
    if (category) {
      filtered = filtered.filter((r) => r.category === category);
    }
    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter((r) => r.recordDate >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      filtered = filtered.filter((r) => r.recordDate <= end);
    }

    return filtered
      .slice(0, limit || 50)
      .map(toFinanceRecordDto);
  },
  {
    name: 'query_finance',
    description: '查询财务记录，可按类型、分类、日期范围筛选',
    schema: z.object({
      type: z.enum(['income', 'expense', 'all']).optional().default('all').describe('记录类型'),
      category: z.string().max(50).optional().describe('分类'),
      startDate: z.string().optional().describe('开始日期'),
      endDate: z.string().optional().describe('结束日期'),
      limit: z.number().max(100).default(50).describe('返回数量限制'),
    }),
  }
);

export const getFinanceStatsTool = tool(
  async () => {
    const records = await listFinanceRecords();
    const income = records.filter((r) => r.type === 'income').reduce((sum, r) => sum + Number(r.amount), 0);
    const expense = records.filter((r) => r.type === 'expense').reduce((sum, r) => sum + Number(r.amount), 0);
    return {
      totalRecords: records.length,
      totalIncome: income,
      totalExpense: expense,
      balance: income - expense,
    };
  },
  {
    name: 'get_finance_stats',
    description: '获取财务统计数据',
    schema: z.object({}),
  }
);

export const searchKnowledgeTool = tool(
  async ({ query, tags, limit }) => {
    return searchNotes({
      query: query || '',
      tags: tags || undefined,
      limit: limit || 8,
      offset: 0,
    });
  },
  {
    name: 'search_knowledge',
    description: '搜索知识库笔记',
    schema: z.object({
      query: z.string().max(200).optional().describe('搜索关键词'),
      tags: z.array(z.string().max(50)).max(10).optional().describe('标签筛选'),
      limit: z.number().max(20).default(8).describe('返回数量限制'),
    }),
  }
);

// ============ 写操作工具（需用户确认） ============

export const createTaskTool = tool(
  async ({ title, description, priority, dueDate }) => {
    const task = await createTask({
      title: title.trim(),
      notes: description?.trim() || undefined,
      priority: priority || 'medium',
      dueDate: dueDate || undefined,
    });
    return toTaskDto(task);
  },
  {
    name: 'create_task',
    description: '创建新任务（需用户确认）',
    schema: z.object({
      title: z.string().trim().min(1).max(200).describe('任务标题'),
      description: z.string().trim().max(500).optional().describe('任务描述'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级'),
      dueDate: z.string().trim().max(30).optional().describe('截止日期'),
    }),
  }
);

export const addFinanceRecordTool = tool(
  async ({ type, amount, description, category, date }) => {
    const record = await createFinanceRecord({
      type,
      amount,
      description: description.trim(),
      category: category.trim(),
      date: date,
    });
    return toFinanceRecordDto(record);
  },
  {
    name: 'add_finance_record',
    description: '新增财务记录（需用户确认）',
    schema: z.object({
      type: z.enum(['income', 'expense']).describe('记录类型'),
      amount: z.number().min(0).max(999999999.99).describe('金额'),
      description: z.string().trim().min(1).max(500).describe('描述'),
      category: z.string().trim().min(1).max(50).describe('分类'),
      date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).describe('日期（YYYY-MM-DD）'),
    }),
  }
);

export const updateTaskTool = tool(
  async ({ id, title, completed, priority, dueDate }) => {
    const existing = await findTaskById(id);
    if (!existing) {
      throw new Error(`未找到任务: ${id}`);
    }

    const updated = await updateTask(id, {
      ...(title ? { title: title.trim() } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(priority ? { priority } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate || null } : {}),
      version: existing.version,
    });

    if (!updated) {
      throw new Error(`任务已被其他请求修改: ${id}`);
    }

    return toTaskDto(updated);
  },
  {
    name: 'update_task',
    description: '更新任务（需用户确认）',
    schema: z.object({
      id: z.string().uuid().describe('任务ID'),
      title: z.string().trim().min(1).max(200).optional().describe('新标题'),
      completed: z.boolean().optional().describe('完成状态'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级'),
      dueDate: z.string().trim().max(30).optional().describe('截止日期'),
    }),
  }
);

export const deleteTaskTool = tool(
  async ({ id }) => {
    const existing = await findTaskById(id);
    if (!existing) {
      throw new Error(`未找到任务: ${id}`);
    }

    const deleted = await softDeleteTask(id);
    return {
      id: deleted.id,
      deleted: true,
    };
  },
  {
    name: 'delete_task',
    description: '删除任务（需用户确认）',
    schema: z.object({
      id: z.string().uuid().describe('任务ID'),
    }),
  }
);

// ============ 工具注册表 ============

/**
 * 工具元数据 - 包含是否需要用户确认
 */
export interface ToolMetadata {
  requiresConfirmation: boolean;
}

export const toolMetadata: Record<string, ToolMetadata> = {
  query_tasks: { requiresConfirmation: false },
  get_task_stats: { requiresConfirmation: false },
  query_finance: { requiresConfirmation: false },
  get_finance_stats: { requiresConfirmation: false },
  search_knowledge: { requiresConfirmation: false },
  create_task: { requiresConfirmation: true },
  add_finance_record: { requiresConfirmation: true },
  update_task: { requiresConfirmation: true },
  delete_task: { requiresConfirmation: true },
};

/**
 * 获取所有工具列表
 */
export const allTools = [
  queryTasksTool,
  getTaskStatsTool,
  queryFinanceTool,
  getFinanceStatsTool,
  searchKnowledgeTool,
  createTaskTool,
  addFinanceRecordTool,
  updateTaskTool,
  deleteTaskTool,
];

/**
 * 检查工具是否需要确认
 */
export function requiresConfirmation(toolName: string): boolean {
  return toolMetadata[toolName]?.requiresConfirmation ?? false;
}