import type { JSONSchema, Tool, ToolResult } from '../types';
import { financeDB, taskDB, type FinanceRecord, type Task } from '../../db';
import { getWeatherTool, getCurrentTimeTool, httpRequestTool, manageApiConfigTool } from './httpTool';

function validateParams(params: Record<string, unknown>, schema: JSONSchema): string | null {
  if (!schema.required) {
    return null;
  }

  for (const requiredKey of schema.required) {
    if (params[requiredKey] === undefined) {
      return `缺少必填参数: ${requiredKey}`;
    }
  }

  return null;
}

function getUserProfile(): { name: string; email: string; bio: string } | null {
  try {
    const stored = localStorage.getItem('user_profile');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setUserProfile(profile: { name: string; email: string; bio: string }) {
  localStorage.setItem('user_profile', JSON.stringify(profile));
}

const queryFinanceTool: Tool = {
  name: 'query_finance',
  description: '查询财务记录，支持按类型、日期范围和分类筛选',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['income', 'expense', 'all'], description: '记录类型' },
      category: { type: 'string', description: '分类' },
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
      endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
      limit: { type: 'number', description: '返回数量限制' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const records = await financeDB.getAll();
    const type = (params.type as string) || 'all';
    const category = params.category as string | undefined;
    const startDate = params.startDate as string | undefined;
    const endDate = params.endDate as string | undefined;
    const limit = (params.limit as number) || 20;

    return {
      success: true,
      data: records
        .filter((record) => type === 'all' || record.type === type)
        .filter((record) => !category || record.category === category)
        .filter((record) => !startDate || record.date >= startDate)
        .filter((record) => !endDate || record.date <= endDate)
        .slice(0, limit),
    };
  },
};

const getFinanceStatsTool: Tool = {
  name: 'get_finance_stats',
  description: '获取财务汇总统计',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => ({ success: true, data: await financeDB.getStats() }),
};

const addFinanceRecordTool: Tool = {
  name: 'add_finance_record',
  description: '新增财务记录',
  parameters: {
    type: 'object',
    required: ['type', 'amount', 'description', 'category', 'date'],
    properties: {
      type: { type: 'string', enum: ['income', 'expense'], description: '记录类型' },
      amount: { type: 'number', description: '金额' },
      description: { type: 'string', description: '描述' },
      category: { type: 'string', description: '分类' },
      date: { type: 'string', description: '日期 YYYY-MM-DD' },
      model: { type: 'string', description: '关联模型名称' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, addFinanceRecordTool.parameters);
    if (error) {
      return { success: false, error };
    }

    const record = await financeDB.add({
      type: params.type as 'income' | 'expense',
      amount: params.amount as number,
      description: params.description as string,
      category: params.category as string,
      date: params.date as string,
      model: params.model as string | undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true, data: record };
  },
};

const deleteFinanceRecordTool: Tool = {
  name: 'delete_finance_record',
  description: '删除财务记录',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '记录 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    await financeDB.delete(params.id as string);
    return { success: true };
  },
};

const queryTasksTool: Tool = {
  name: 'query_tasks',
  description: '查询任务列表，支持按完成状态和优先级筛选',
  parameters: {
    type: 'object',
    properties: {
      completed: { type: 'boolean', description: '是否完成' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级' },
      limit: { type: 'number', description: '返回数量限制' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const tasks = await taskDB.getAll();
    const completed = params.completed as boolean | undefined;
    const priority = params.priority as string | undefined;
    const limit = (params.limit as number) || 20;

    return {
      success: true,
      data: tasks
        .filter((task) => completed === undefined || task.completed === completed)
        .filter((task) => !priority || task.priority === priority)
        .slice(0, limit),
    };
  },
};

const getTaskStatsTool: Tool = {
  name: 'get_task_stats',
  description: '获取任务汇总统计',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => ({ success: true, data: await taskDB.getStats() }),
};

const createTaskTool: Tool = {
  name: 'create_task',
  description: '创建任务',
  parameters: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', description: '任务标题' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级' },
      dueDate: { type: 'string', description: '截止日期 YYYY-MM-DD' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const task = await taskDB.add({
      title: params.title as string,
      completed: false,
      priority: (params.priority as 'low' | 'medium' | 'high') || 'medium',
      dueDate: params.dueDate as string | undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true, data: task };
  },
};

const updateTaskTool: Tool = {
  name: 'update_task',
  description: '更新任务属性或完成状态',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '任务 ID' },
      title: { type: 'string', description: '新标题' },
      completed: { type: 'boolean', description: '完成状态' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '优先级' },
      dueDate: { type: 'string', description: '截止日期 YYYY-MM-DD' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const updates: Partial<Task> = {};

    if (params.title !== undefined) updates.title = params.title as string;
    if (params.completed !== undefined) updates.completed = params.completed as boolean;
    if (params.priority !== undefined) updates.priority = params.priority as Task['priority'];
    if (params.dueDate !== undefined) updates.dueDate = params.dueDate as string;

    await taskDB.update(params.id as string, updates);
    return { success: true };
  },
};

const deleteTaskTool: Tool = {
  name: 'delete_task',
  description: '删除任务',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '任务 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    await taskDB.delete(params.id as string);
    return { success: true };
  },
};

const getOverviewTool: Tool = {
  name: 'get_overview',
  description: '获取工作台总览，包含任务和财务摘要',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => ({
    success: true,
    data: {
      finance: await financeDB.getStats(),
      tasks: await taskDB.getStats(),
    },
  }),
};

const crossModuleAnalysisTool: Tool = {
  name: 'cross_module_analysis',
  description: '执行跨模块分析，例如月度摘要、任务与支出关联、支出分类占比',
  parameters: {
    type: 'object',
    properties: {
      analysisType: {
        type: 'string',
        enum: ['monthly_summary', 'productivity_correlation', 'category_breakdown'],
        description: '分析类型',
      },
      month: { type: 'string', description: '月份 YYYY-MM' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const analysisType = params.analysisType as string;
    const month = params.month as string | undefined;
    const finance = await financeDB.getAll();
    const tasks = await taskDB.getAll();

    if (analysisType === 'monthly_summary' && month) {
      const monthFinance = finance.filter((record) => record.date.startsWith(month));
      const monthTasks = tasks.filter((task) => new Date(task.createdAt).toISOString().startsWith(month));
      const income = monthFinance.filter((record) => record.type === 'income').reduce((sum, record) => sum + record.amount, 0);
      const expense = monthFinance.filter((record) => record.type === 'expense').reduce((sum, record) => sum + record.amount, 0);
      const completed = monthTasks.filter((task) => task.completed).length;

      return {
        success: true,
        data: {
          month,
          finance: { income, expense, profit: income - expense },
          tasks: { total: monthTasks.length, completed },
        },
      };
    }

    if (analysisType === 'productivity_correlation') {
      const completed = tasks.filter((task) => task.completed).length;
      const totalExpense = finance.filter((record) => record.type === 'expense').reduce((sum, record) => sum + record.amount, 0);
      return {
        success: true,
        data: {
          taskCompletionRate: tasks.length ? completed / tasks.length : 0,
          totalExpense,
          insight: completed
            ? `已完成 ${completed} 个任务，总支出 ${totalExpense.toFixed(2)}`
            : '暂无足够数据',
        },
      };
    }

    if (analysisType === 'category_breakdown') {
      const categories: Record<string, number> = {};
      finance
        .filter((record) => record.type === 'expense')
        .forEach((record) => {
          categories[record.category] = (categories[record.category] || 0) + record.amount;
        });

      return { success: true, data: { categories } };
    }

    return { success: false, error: '不支持的分析类型' };
  },
};

const calculateExpressionTool: Tool = {
  name: 'calculate_expression',
  description: '执行计算器表达式计算',
  parameters: {
    type: 'object',
    required: ['expression'],
    properties: {
      expression: { type: 'string', description: '只包含数字、小数点、括号和 + - * / 的表达式' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const expression = (params.expression as string).trim();
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      return { success: false, error: '表达式包含不支持的字符' };
    }

    try {
      const result = Function(`"use strict"; return (${expression});`)();
      if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) {
        return { success: false, error: '计算结果无效' };
      }
      return { success: true, data: { expression, result } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '计算失败' };
    }
  },
};

const parseColorTool: Tool = {
  name: 'parse_color',
  description: '解析 HEX 颜色为 RGB',
  parameters: {
    type: 'object',
    required: ['hex'],
    properties: {
      hex: { type: 'string', description: 'HEX 颜色，例如 #165DFF' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const hex = (params.hex as string).trim();
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) {
      return { success: false, error: '无效的 HEX 颜色' };
    }

    return {
      success: true,
      data: {
        hex: `#${match[1]}${match[2]}${match[3]}`.toUpperCase(),
        rgb: {
          r: parseInt(match[1], 16),
          g: parseInt(match[2], 16),
          b: parseInt(match[3], 16),
        },
      },
    };
  },
};

const formatJsonTool: Tool = {
  name: 'format_json',
  description: '格式化或压缩 JSON 文本',
  parameters: {
    type: 'object',
    required: ['input'],
    properties: {
      input: { type: 'string', description: 'JSON 文本' },
      mode: { type: 'string', enum: ['pretty', 'minify'], description: 'pretty 为格式化，minify 为压缩' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const input = params.input as string;
    const mode = (params.mode as string) || 'pretty';

    try {
      const parsed = JSON.parse(input);
      return {
        success: true,
        data: {
          mode,
          output: mode === 'minify' ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'JSON 解析失败' };
    }
  },
};

const getSettingsOverviewTool: Tool = {
  name: 'get_settings_overview',
  description: '读取设置模块概览，包括个人资料、主题、PIN 状态、数据量和 API Provider 摘要',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => {
    const profile = getUserProfile();
    const theme = localStorage.getItem('theme') || 'light';
    const pinEnabled = !!localStorage.getItem('security_pin_hashed');
    const dataStats = await (await import('../../db')).dataManager.getStats();
    const providers = (await import('../../lib/apiConfig')).getApiConfigs().map((provider) => ({
      id: provider.id,
      name: provider.name,
      isActive: provider.isActive,
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      model: provider.model,
    }));

    return {
      success: true,
      data: {
        profile,
        theme,
        pinEnabled,
        dataStats,
        providers,
      },
    };
  },
};

const updateProfileTool: Tool = {
  name: 'update_profile',
  description: '更新设置中的个人资料',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '名称' },
      email: { type: 'string', description: '邮箱' },
      bio: { type: 'string', description: '简介' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const current = getUserProfile() || { name: '个人用户', email: '', bio: '' };
    const nextProfile = {
      name: (params.name as string | undefined) ?? current.name,
      email: (params.email as string | undefined) ?? current.email,
      bio: (params.bio as string | undefined) ?? current.bio,
    };
    setUserProfile(nextProfile);
    return { success: true, data: nextProfile };
  },
};

const setThemeTool: Tool = {
  name: 'set_theme',
  description: '设置主题为 light 或 dark',
  parameters: {
    type: 'object',
    required: ['theme'],
    properties: {
      theme: { type: 'string', enum: ['light', 'dark'], description: '主题模式' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const theme = params.theme as 'light' | 'dark';
    localStorage.setItem('theme', theme);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    return { success: true, data: { theme } };
  },
};

export const toolRegistry: Map<string, Tool> = new Map([
  [queryFinanceTool.name, queryFinanceTool],
  [getFinanceStatsTool.name, getFinanceStatsTool],
  [addFinanceRecordTool.name, addFinanceRecordTool],
  [deleteFinanceRecordTool.name, deleteFinanceRecordTool],

  [queryTasksTool.name, queryTasksTool],
  [getTaskStatsTool.name, getTaskStatsTool],
  [createTaskTool.name, createTaskTool],
  [updateTaskTool.name, updateTaskTool],
  [deleteTaskTool.name, deleteTaskTool],

  [getOverviewTool.name, getOverviewTool],
  [crossModuleAnalysisTool.name, crossModuleAnalysisTool],

  [calculateExpressionTool.name, calculateExpressionTool],
  [parseColorTool.name, parseColorTool],
  [formatJsonTool.name, formatJsonTool],

  [getSettingsOverviewTool.name, getSettingsOverviewTool],
  [updateProfileTool.name, updateProfileTool],
  [setThemeTool.name, setThemeTool],

  [httpRequestTool.name, httpRequestTool],
  [manageApiConfigTool.name, manageApiConfigTool],
  [getWeatherTool.name, getWeatherTool],
  [getCurrentTimeTool.name, getCurrentTimeTool],
]);

export type { Tool, ToolResult };
