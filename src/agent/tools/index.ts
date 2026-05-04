import type { JSONSchema, Tool, ToolResult } from '../types';
import { financeDB, taskDB, type FinanceRecord, type Task } from '../../db';
import { getWeatherTool, getCurrentTimeTool, httpRequestTool, manageApiConfigTool } from './httpTool';
import {
  createKnowledgeRelation,
  deleteKnowledgeAssertion,
  deleteKnowledgeDocument,
  deleteKnowledgeEntity,
  deleteKnowledgeRelation,
  getKnowledgeEntityById,
  getKnowledgeOverview,
  getKnowledgeRelatedById,
  searchKnowledge,
  upsertKnowledgeAssertion,
  upsertKnowledgeDocument,
  upsertKnowledgeEntity,
} from '../../kb';

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

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function toRecordObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function toKnowledgeScalar(value: unknown): string | number | boolean | null | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return undefined;
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

    // 严格校验：只允许数字、小数点、括号、空格和基本运算符
    // 使用更精确的正则，避免 + - 在字符类中的歧义
    if (!/^[0-9.\s()+\-*/]+$/.test(expression)) {
      return { success: false, error: '表达式包含不支持的字符' };
    }

    // 检查括号匹配
    let parenCount = 0;
    for (const char of expression) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) {
        return { success: false, error: '括号不匹配' };
      }
    }
    if (parenCount !== 0) {
      return { success: false, error: '括号不匹配' };
    }

    // 使用安全的表达式解析器
    try {
      const result = safeEvaluate(expression);
      if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) {
        return { success: false, error: '计算结果无效' };
      }
      return { success: true, data: { expression, result } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '计算失败' };
    }
  },
};

/**
 * 安全的数学表达式解析器
 * 使用递归下降解析，避免代码注入风险
 */
function safeEvaluate(expression: string): number {
  let pos = 0;
  const chars = expression.replace(/\s+/g, '');

  function parseNumber(): number {
    let num = '';
    while (pos < chars.length && (chars[pos] === '.' || /[0-9]/.test(chars[pos]))) {
      num += chars[pos++];
    }
    const result = parseFloat(num);
    if (Number.isNaN(result)) {
      throw new Error('无效的数字格式');
    }
    return result;
  }

  function parseFactor(): number {
    if (chars[pos] === '(') {
      pos++; // skip '('
      const result = parseExpression();
      if (chars[pos] !== ')') {
        throw new Error('缺少右括号');
      }
      pos++; // skip ')'
      return result;
    }
    if (chars[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    if (chars[pos] === '+') {
      pos++;
      return parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (pos < chars.length && (chars[pos] === '*' || chars[pos] === '/')) {
      const op = chars[pos++];
      const right = parseFactor();
      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new Error('除数不能为零');
        }
        left = left / right;
      }
    }
    return left;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (pos < chars.length && (chars[pos] === '+' || chars[pos] === '-')) {
      const op = chars[pos++];
      const right = parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseExpression();
  if (pos !== chars.length) {
    throw new Error('表达式解析不完整');
  }
  return result;
}

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

const getKnowledgeOverviewTool: Tool = {
  name: 'get_knowledge_overview',
  description: '获取知识库概览，包括本体类、关系、实体、文档和断言数量',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async () => ({
    success: true,
    data: getKnowledgeOverview(),
  }),
};

const searchKnowledgeTool: Tool = {
  name: 'search_knowledge',
  description: '按关键词、类型和标签搜索知识库中的实体与文档',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，可为空；为空时返回最近更新项' },
      typeIds: { type: 'array', items: { type: 'string' }, description: '实体类型 ID 数组，例如 [\"class:concept\"]' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签数组，例如 [\"architecture\"]' },
      includeDocuments: { type: 'boolean', description: '是否同时搜索文档，默认 true' },
      limit: { type: 'number', description: '返回数量限制，默认 8' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => ({
    success: true,
    data: searchKnowledge((params.query as string) || '', {
      typeIds: Array.isArray(params.typeIds)
        ? params.typeIds.filter((item): item is string => typeof item === 'string')
        : undefined,
      tags: Array.isArray(params.tags)
        ? params.tags.filter((item): item is string => typeof item === 'string')
        : undefined,
      includeDocuments: params.includeDocuments !== false,
      limit: typeof params.limit === 'number' ? params.limit : 8,
    }),
  }),
};

const getKnowledgeEntityTool: Tool = {
  name: 'get_knowledge_entity',
  description: '获取知识库实体详情，包括属性、关系和关联实体',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '实体 ID' },
      relationDepth: { type: 'number', description: '关联实体展开深度，默认 1，最大 2' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params) => {
    const id = params.id as string;
    const entity = getKnowledgeEntityById(id);
    if (!entity) {
      return { success: false, error: `未找到知识实体: ${id}` };
    }

    const relationDepth = Math.max(1, Math.min(typeof params.relationDepth === 'number' ? params.relationDepth : 1, 2));
    return {
      success: true,
      data: {
        entity,
        relatedEntities: getKnowledgeRelatedById(id, relationDepth),
      },
    };
  },
};

const upsertKnowledgeEntityTool: Tool = {
  name: 'upsert_knowledge_entity',
  description: '新增或更新知识库实体，可写入类型、标题、摘要、标签、别名、来源、置信度和结构化属性',
  parameters: {
    type: 'object',
    required: ['typeId', 'title'],
    properties: {
      id: { type: 'string', description: '实体 ID；传入时更新，不传时创建' },
      typeId: { type: 'string', description: '实体类型 ID，例如 class:project' },
      title: { type: 'string', description: '实体标题' },
      summary: { type: 'string', description: '实体摘要' },
      aliases: { type: 'array', items: { type: 'string' }, description: '别名数组，例如 [\"Workspace\"]' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签数组，例如 [\"project\", \"workspace\"]' },
      attributes: { type: 'object', description: '结构化属性对象，例如 {\"status\":\"active\"}' } as JSONSchema,
      source: { type: 'string', description: '来源说明' },
      confidence: { type: 'number', description: '置信度，范围 0-1' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, upsertKnowledgeEntityTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      const entity = await upsertKnowledgeEntity({
        id: params.id as string | undefined,
        typeId: params.typeId as string,
        title: params.title as string,
        summary: params.summary as string | undefined,
        aliases: toStringArray(params.aliases),
        tags: toStringArray(params.tags),
        attributes: toRecordObject(params.attributes) as Record<string, string | number | boolean | null | Array<string | number | boolean | null> | Record<string, string | number | boolean | null>> | undefined,
        source: params.source as string | undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
      });

      return { success: true, data: entity };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识实体写入失败',
      };
    }
  },
};

const createKnowledgeRelationTool: Tool = {
  name: 'create_knowledge_relation',
  description: '为两个知识实体创建结构化关系边，并同步生成对应断言',
  parameters: {
    type: 'object',
    required: ['subjectId', 'predicateId', 'targetId'],
    properties: {
      subjectId: { type: 'string', description: '起点实体 ID' },
      predicateId: { type: 'string', description: '关系类型 ID，例如 relation:relatedTo' },
      targetId: { type: 'string', description: '目标实体 ID' },
      source: { type: 'string', description: '来源说明' },
      confidence: { type: 'number', description: '置信度，范围 0-1' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, createKnowledgeRelationTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      const assertion = await createKnowledgeRelation({
        subjectId: params.subjectId as string,
        predicateId: params.predicateId as string,
        targetId: params.targetId as string,
        source: params.source as string | undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
      });

      return { success: true, data: assertion };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识关系创建失败',
      };
    }
  },
};

const upsertKnowledgeDocumentTool: Tool = {
  name: 'upsert_knowledge_document',
  description: '新增或更新知识库文档，可写入正文、标签、关联实体和来源',
  parameters: {
    type: 'object',
    required: ['title'],
    properties: {
      id: { type: 'string', description: '文档 ID；传入时更新，不传时创建' },
      title: { type: 'string', description: '文档标题' },
      summary: { type: 'string', description: '文档摘要' },
      content: { type: 'string', description: '正文内容' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签数组' },
      entityIds: { type: 'array', items: { type: 'string' }, description: '关联实体 ID 数组' },
      source: { type: 'string', description: '来源说明' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, upsertKnowledgeDocumentTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      const document = await upsertKnowledgeDocument({
        id: params.id as string | undefined,
        title: params.title as string,
        summary: params.summary as string | undefined,
        content: params.content as string | undefined,
        tags: toStringArray(params.tags),
        entityIds: toStringArray(params.entityIds),
        source: params.source as string | undefined,
      });

      return { success: true, data: document };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识文档写入失败',
      };
    }
  },
};

const upsertKnowledgeAssertionTool: Tool = {
  name: 'upsert_knowledge_assertion',
  description: '新增或更新知识断言，可记录主体、谓词、目标对象、标量值、证据文档、来源和置信度',
  parameters: {
    type: 'object',
    required: ['subjectId', 'predicateId'],
    properties: {
      id: { type: 'string', description: '断言 ID；传入时更新，不传时创建' },
      subjectId: { type: 'string', description: '断言主体实体 ID' },
      predicateId: { type: 'string', description: '谓词 ID' },
      objectId: { type: 'string', description: '目标对象 ID，可为实体或文档' },
      value: { type: 'string', description: '标量值；支持字符串、数字、布尔值或 null' },
      evidenceDocumentIds: { type: 'array', items: { type: 'string' }, description: '证据文档 ID 数组' },
      source: { type: 'string', description: '来源说明' },
      confidence: { type: 'number', description: '置信度，范围 0-1' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, upsertKnowledgeAssertionTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      const assertion = await upsertKnowledgeAssertion({
        id: params.id as string | undefined,
        subjectId: params.subjectId as string,
        predicateId: params.predicateId as string,
        objectId: params.objectId as string | undefined,
        value: toKnowledgeScalar(params.value),
        evidenceDocumentIds: toStringArray(params.evidenceDocumentIds),
        source: params.source as string | undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
      });

      return { success: true, data: assertion };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识断言写入失败',
      };
    }
  },
};

const deleteKnowledgeEntityTool: Tool = {
  name: 'delete_knowledge_entity',
  description: '删除知识库实体，并级联清理相关文档关联、关系边和断言',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '实体 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, deleteKnowledgeEntityTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      await deleteKnowledgeEntity(params.id as string);
      return { success: true };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识实体删除失败',
      };
    }
  },
};

const deleteKnowledgeDocumentTool: Tool = {
  name: 'delete_knowledge_document',
  description: '删除知识库文档，并清理相关证据引用和指向该文档的断言',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '文档 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, deleteKnowledgeDocumentTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      await deleteKnowledgeDocument(params.id as string);
      return { success: true };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识文档删除失败',
      };
    }
  },
};

const deleteKnowledgeAssertionTool: Tool = {
  name: 'delete_knowledge_assertion',
  description: '删除知识断言；如果断言对应结构化关系边，也会同步撤销',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: '断言 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, deleteKnowledgeAssertionTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      await deleteKnowledgeAssertion(params.id as string);
      return { success: true };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识断言删除失败',
      };
    }
  },
};

const deleteKnowledgeRelationTool: Tool = {
  name: 'delete_knowledge_relation',
  description: '删除两个实体间的结构化关系，并同步移除对应断言',
  parameters: {
    type: 'object',
    required: ['subjectId', 'predicateId', 'targetId'],
    properties: {
      subjectId: { type: 'string', description: '起点实体 ID' },
      predicateId: { type: 'string', description: '关系类型 ID' },
      targetId: { type: 'string', description: '目标实体 ID' },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params) => {
    const error = validateParams(params, deleteKnowledgeRelationTool.parameters);
    if (error) {
      return { success: false, error };
    }

    try {
      await deleteKnowledgeRelation(
        params.subjectId as string,
        params.predicateId as string,
        params.targetId as string
      );
      return { success: true };
    } catch (toolError) {
      return {
        success: false,
        error: toolError instanceof Error ? toolError.message : '知识关系删除失败',
      };
    }
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

  [getKnowledgeOverviewTool.name, getKnowledgeOverviewTool],
  [searchKnowledgeTool.name, searchKnowledgeTool],
  [getKnowledgeEntityTool.name, getKnowledgeEntityTool],
  [upsertKnowledgeEntityTool.name, upsertKnowledgeEntityTool],
  [createKnowledgeRelationTool.name, createKnowledgeRelationTool],
  [upsertKnowledgeDocumentTool.name, upsertKnowledgeDocumentTool],
  [upsertKnowledgeAssertionTool.name, upsertKnowledgeAssertionTool],
  [deleteKnowledgeEntityTool.name, deleteKnowledgeEntityTool],
  [deleteKnowledgeDocumentTool.name, deleteKnowledgeDocumentTool],
  [deleteKnowledgeAssertionTool.name, deleteKnowledgeAssertionTool],
  [deleteKnowledgeRelationTool.name, deleteKnowledgeRelationTool],

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
