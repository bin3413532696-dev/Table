import type { Tool, ToolResult, JSONSchema } from '../types';
import { financeDB, taskDB, type FinanceRecord, type Task } from '../../db';
import { noteOperations } from '../../db/knowledge';
import { searchVectors, getIndexedCount } from '../../lib/vectorStore';
import { isLoaded as isEmbeddingLoaded } from '../../lib/embeddings';

/** 简单参数验证 */
function validateParams(params: Record<string, unknown>, schema: JSONSchema): string | null {
  if (schema.required) {
    for (const req of schema.required) {
      if (params[req] === undefined) {
        return `缺少必需参数: ${req}`;
      }
    }
  }
  return null;
}

// ==================== 财务工具 ====================

const queryFinanceTool: Tool = {
  name: 'query_finance',
  description: '查询财务记录，支持按类型、日期范围、类别筛选',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['income', 'expense', 'all'], description: '记录类型', default: 'all' },
      category: { type: 'string', description: '类别筛选' },
      startDate: { type: 'string', description: '开始日期 (YYYY-MM-DD)' },
      endDate: { type: 'string', description: '结束日期 (YYYY-MM-DD)' },
      limit: { type: 'number', description: '返回数量限制', default: 20 },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const records = await financeDB.getAll();
    let filtered = records;

    // 类型筛选
    const type = params.type as string;
    if (type && type !== 'all') {
      filtered = filtered.filter(r => r.type === type);
    }

    // 类别筛选
    const category = params.category as string;
    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    // 日期筛选
    const startDate = params.startDate as string;
    const endDate = params.endDate as string;
    if (startDate) {
      filtered = filtered.filter(r => r.date >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(r => r.date <= endDate);
    }

    // 数量限制
    const limit = (params.limit as number) || 20;
    filtered = filtered.slice(0, limit);

    return { success: true, data: filtered };
  },
};

const getFinanceStatsTool: Tool = {
  name: 'get_finance_stats',
  description: '获取财务统计数据：总收入、总支出、净利润',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => {
    const stats = await financeDB.getStats();
    return { success: true, data: stats };
  },
};

const addFinanceRecordTool: Tool = {
  name: 'add_finance_record',
  description: '添加新的财务记录',
  parameters: {
    type: 'object',
    required: ['type', 'amount', 'description', 'category', 'date'],
    properties: {
      type: { type: 'string', enum: ['income', 'expense'], description: '类型' },
      amount: { type: 'number', description: '金额' },
      description: { type: 'string', description: '描述' },
      category: { type: 'string', description: '类别' },
      date: { type: 'string', description: '日期 (YYYY-MM-DD)' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, addFinanceRecordTool.parameters);
    if (error) return { success: false, error };

    const record = await financeDB.add({
      type: params.type as 'income' | 'expense',
      amount: params.amount as number,
      description: params.description as string,
      category: params.category as string,
      date: params.date as string,
    });

    return { success: true, data: record };
  },
};

const deleteFinanceRecordTool: Tool = {
  name: 'delete_finance_record',
  description: '删除指定的财务记录',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '记录ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const id = params.id as string;
    await financeDB.delete(id);
    return { success: true };
  },
};

// ==================== 任务工具 ====================

const queryTasksTool: Tool = {
  name: 'query_tasks',
  description: '查询任务列表，支持按状态、优先级筛选',
  parameters: {
    type: 'object',
    properties: {
      completed: { type: 'boolean', description: '完成状态' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级' },
      limit: { type: 'number', description: '返回数量限制', default: 20 },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const tasks = await taskDB.getAll();
    let filtered = tasks;

    const completed = params.completed;
    if (completed !== undefined) {
      filtered = filtered.filter(t => t.completed === completed);
    }

    const priority = params.priority as string;
    if (priority) {
      filtered = filtered.filter(t => t.priority === priority);
    }

    const limit = (params.limit as number) || 20;
    filtered = filtered.slice(0, limit);

    return { success: true, data: filtered };
  },
};

const getTaskStatsTool: Tool = {
  name: 'get_task_stats',
  description: '获取任务统计数据：总数、已完成、待完成',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => {
    const stats = await taskDB.getStats();
    return { success: true, data: stats };
  },
};

const createTaskTool: Tool = {
  name: 'create_task',
  description: '创建新任务',
  parameters: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', description: '任务标题' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级', default: 'medium' },
      dueDate: { type: 'string', description: '截止日期 (YYYY-MM-DD)' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const task = await taskDB.add({
      title: params.title as string,
      completed: false,
      createdAt: new Date().toISOString(),
      priority: (params.priority as 'low' | 'medium' | 'high') || 'medium',
      dueDate: params.dueDate as string | undefined,
    });

    return { success: true, data: task };
  },
};

const updateTaskTool: Tool = {
  name: 'update_task',
  description: '更新任务状态或属性',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '任务ID' },
      title: { type: 'string', description: '新标题' },
      completed: { type: 'boolean', description: '完成状态' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级' },
      dueDate: { type: 'string', description: '截止日期' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const id = params.id as string;
    const updates: Partial<Task> = {};

    if (params.title) updates.title = params.title as string;
    if (params.completed !== undefined) updates.completed = params.completed as boolean;
    if (params.priority) updates.priority = params.priority as 'low' | 'medium' | 'high';
    if (params.dueDate) updates.dueDate = params.dueDate as string;

    await taskDB.update(id, updates);
    return { success: true };
  },
};

const deleteTaskTool: Tool = {
  name: 'delete_task',
  description: '删除指定任务',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '任务ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const id = params.id as string;
    await taskDB.delete(id);
    return { success: true };
  },
};

// ==================== 知识库工具 ====================

const searchKnowledgeTool: Tool = {
  name: 'search_knowledge',
  description: '使用语义搜索查询知识库笔记',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: '搜索关键词或语义描述' },
      topK: { type: 'number', description: '返回结果数量', default: 5 },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const query = params.query as string;
    const topK = (params.topK as number) || 5;

    // 检查嵌入模型是否加载
    if (!isEmbeddingLoaded()) {
      // 回退到关键词搜索
      const notes = await noteOperations.getAll();
      const keywordResults = notes.filter(n =>
        n.title.includes(query) || n.content.includes(query)
      ).slice(0, topK);
      return { success: true, data: keywordResults, note: '语义搜索未就绪，使用关键词搜索' };
    }

    const results = await searchVectors(query, topK);
    return { success: true, data: results };
  },
};

const getKnowledgeIndexStatusTool: Tool = {
  name: 'get_knowledge_index_status',
  description: '获取知识库向量索引状态',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => {
    const count = await getIndexedCount();
    return { success: true, data: { indexedCount: count, embeddingLoaded: isEmbeddingLoaded() } };
  },
};

const listNotesTool: Tool = {
  name: 'list_notes',
  description: '列出所有笔记',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '返回数量限制', default: 20 },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const limit = (params.limit as number) || 20;
    const notes = await noteOperations.getAll();
    return { success: true, data: notes.slice(0, limit) };
  },
};

// ==================== 跨模块分析工具 ====================

const getOverviewTool: Tool = {
  name: 'get_overview',
  description: '获取全局概览：财务摘要、任务进度、知识库状态',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => {
    const financeStats = await financeDB.getStats();
    const taskStats = await taskDB.getStats();
    const noteCount = await noteOperations.getCount();

    return {
      success: true,
      data: {
        finance: financeStats,
        tasks: taskStats,
        knowledge: { noteCount },
      },
    };
  },
};

const crossModuleAnalysisTool: Tool = {
  name: 'cross_module_analysis',
  description: '执行跨模块数据分析',
  parameters: {
    type: 'object',
    properties: {
      analysisType: {
        type: 'string',
        enum: ['monthly_summary', 'productivity_correlation', 'category_breakdown'],
        description: '分析类型',
      },
      month: { type: 'string', description: '分析月份 (YYYY-MM)' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const analysisType = params.analysisType as string;
    const month = params.month as string;

    const finance = await financeDB.getAll();
    const tasks = await taskDB.getAll();

    if (analysisType === 'monthly_summary' && month) {
      const monthFinance = finance.filter(r => r.date.startsWith(month));
      const monthTasks = tasks.filter(t => t.createdAt.startsWith(month));

      const income = monthFinance.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
      const expense = monthFinance.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
      const completedTasks = monthTasks.filter(t => t.completed).length;

      return {
        success: true,
        data: {
          month,
          finance: { income, expense, profit: income - expense },
          tasks: { total: monthTasks.length, completed: completedTasks },
        },
      };
    }

    if (analysisType === 'productivity_correlation') {
      // 简单的生产力与支出关联分析
      const completedCount = tasks.filter(t => t.completed).length;
      const totalExpense = finance.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

      return {
        success: true,
        data: {
          taskCompletionRate: tasks.length > 0 ? completedCount / tasks.length : 0,
          totalExpense,
          insight: completedCount > 0 && totalExpense > 0
            ? `完成任务 ${completedCount} 个，总支出 ${totalExpense.toFixed(2)}`
            : '数据不足',
        },
      };
    }

    if (analysisType === 'category_breakdown') {
      const categories: Record<string, number> = {};
      finance.filter(r => r.type === 'expense').forEach(r => {
        categories[r.category] = (categories[r.category] || 0) + r.amount;
      });

      return { success: true, data: { categories } };
    }

    return { success: false, error: '未知的分析类型' };
  },
};

// ==================== 工具注册表 ====================

export const toolRegistry: Map<string, Tool> = new Map([
  // 财务工具
  [queryFinanceTool.name, queryFinanceTool],
  [getFinanceStatsTool.name, getFinanceStatsTool],
  [addFinanceRecordTool.name, addFinanceRecordTool],
  [deleteFinanceRecordTool.name, deleteFinanceRecordTool],

  // 任务工具
  [queryTasksTool.name, queryTasksTool],
  [getTaskStatsTool.name, getTaskStatsTool],
  [createTaskTool.name, createTaskTool],
  [updateTaskTool.name, updateTaskTool],
  [deleteTaskTool.name, deleteTaskTool],

  // 知识库工具
  [searchKnowledgeTool.name, searchKnowledgeTool],
  [getKnowledgeIndexStatusTool.name, getKnowledgeIndexStatusTool],
  [listNotesTool.name, listNotesTool],

  // 分析工具
  [getOverviewTool.name, getOverviewTool],
  [crossModuleAnalysisTool.name, crossModuleAnalysisTool],
]);

export type { Tool, ToolResult };