import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listTasks } from '../../tasks/repository';
import { toTaskDto } from '../../tasks/dto';
import { listFinanceRecords, createFinanceRecord } from '../../finance/repository';
import { toFinanceRecordDto } from '../../finance/dto';
import { searchNotes } from '../../knowledge/repository';
import { searchForAgent, searchForAgentStructured, getChunkById } from '../../knowledge-rag/service';
import { formatStructuredContextForAgent } from '../../knowledge-rag/retrieval';
import { ragConfig } from '../../knowledge-rag/config';
import { createTask, findTaskById, updateTask, deleteTask } from '../../tasks/repository';

const taskPriorityEnum = z.enum(['low', 'medium', 'high']);

function normalizeTaskPriority(value: unknown): 'low' | 'medium' | 'high' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const priorityMap: Record<string, 'low' | 'medium' | 'high'> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    l: 'low',
    m: 'medium',
    h: 'high',
    '低': 'low',
    '低优先级': 'low',
    '低优先': 'low',
    '中': 'medium',
    '中等': 'medium',
    '中优先级': 'medium',
    '中优先': 'medium',
    '普通': 'medium',
    '默认': 'medium',
    '高': 'high',
    '高优先级': 'high',
    '高优先': 'high',
    '重要': 'high',
    '紧急': 'high',
  };

  return priorityMap[normalized];
}

const taskPriorityInputSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return normalizeTaskPriority(value) ?? value;
}, taskPriorityEnum.optional());

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
    description: '查询任务列表，可按完成状态和优先级筛选。',
    schema: z.object({
      completed: z.boolean().optional().describe('是否已完成'),
      priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
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
    description: '获取任务统计数据。',
    schema: z.object({}),
  }
);

export const queryFinanceTool = tool(
  async ({ type, category, startDate, endDate, limit }) => {
    const records = await listFinanceRecords();
    let filtered = records;

    if (type && type !== 'all') {
      filtered = filtered.filter((record) => record.type === type);
    }
    if (category) {
      filtered = filtered.filter((record) => record.category === category);
    }
    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter((record) => record.recordDate >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      filtered = filtered.filter((record) => record.recordDate <= end);
    }

    return filtered.slice(0, limit || 50).map(toFinanceRecordDto);
  },
  {
    name: 'query_finance',
    description: '查询财务记录，可按类型、分类、日期范围筛选。',
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
    const income = records
      .filter((record) => record.type === 'income')
      .reduce((sum, record) => sum + Number(record.amount), 0);
    const expense = records
      .filter((record) => record.type === 'expense')
      .reduce((sum, record) => sum + Number(record.amount), 0);

    return {
      totalRecords: records.length,
      totalIncome: income,
      totalExpense: expense,
      balance: income - expense,
    };
  },
  {
    name: 'get_finance_stats',
    description: '获取财务统计数据。',
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
    description: '搜索知识库笔记（关键词搜索）。',
    schema: z.object({
      query: z.string().max(200).optional().describe('搜索关键词'),
      tags: z.array(z.string().max(50)).max(10).optional().describe('标签筛选'),
      limit: z.number().max(20).default(8).describe('返回数量限制'),
    }),
  }
);

export const searchKnowledgeRagTool = tool(
  async ({ query, limit }) => {
    if (!query || query.trim().length === 0) {
      return '请提供搜索查询内容。';
    }
    try {
      return await searchForAgent(query, limit || 10);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('RAG搜索失败:', message);
      return `知识库搜索失败: ${message}。请稍后重试或尝试其他搜索方式。`;
    }
  },
  {
    name: 'search_knowledge_rag',
    description: '搜索知识库文档（语义检索，支持 PDF、Markdown 等文档内容）。返回格式化的上下文内容供回答问题使用。',
    schema: z.object({
      query: z.string().max(500).describe('搜索查询，支持自然语言问题'),
      limit: z.number().int().min(1).max(50).default(10).describe('返回数量限制'),
    }),
  }
);

// =====================================================
// 新增：细粒度 RAG 工具（G1/G2）
// =====================================================

/**
 * 语义搜索工具（返回结构化结果，保留 chunk ID）
 */
export const semanticSearchTool = tool(
  async ({ query, tags, documentIds, limit }) => {
    if (!query || query.trim().length === 0) {
      return formatStructuredContextForAgent([]);
    }
    try {
      const result = await searchForAgentStructured({
        query,
        mode: 'semantic',
        tags: tags || undefined,
        documentIds: documentIds || undefined,
        limit: limit || 10,
        threshold: ragConfig.SEARCH_MIN_THRESHOLD,
        fusionWeight: ragConfig.SEARCH_FUSION_WEIGHT,
        enableRerank: ragConfig.RERANKER_ENABLED_BY_DEFAULT ?? true,
        rerankerThreshold: ragConfig.RERANKER_MIN_SCORE,
        useBm25: false,
        enableQueryPreprocess: ragConfig.QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT ?? false,
        enableExpansion: false,
        enableRewrite: true,
        enableMmr: ragConfig.MMR_ENABLED_BY_DEFAULT ?? false,
        mmrLambda: ragConfig.MMR_LAMBDA,
      });
      // 传递原始语义最高分数，用于 Retrieval Grader
      return formatStructuredContextForAgent(result.results, 3000, result.maxScore);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('语义搜索失败:', message);
      return `<search_result><message>搜索失败: ${message}</message><chunks></chunks></search_result>`;
    }
  },
  {
    name: 'semantic_search',
    description: '语义搜索知识库文档。基于向量相似度检索，适合概念性问题。返回带 chunk ID 的结构化结果，可用于 cite_sources 工具。',
    schema: z.object({
      query: z.string().max(500).describe('自然语言查询'),
      tags: z.array(z.string().max(50)).max(10).optional().describe('按标签筛选'),
      documentIds: z.array(z.string().uuid()).max(20).optional().describe('限定文档范围'),
      limit: z.number().int().min(1).max(50).default(10).describe('返回数量'),
    }),
  }
);

/**
 * 关键词搜索工具（返回结构化结果，保留 chunk ID）
 */
export const keywordSearchTool = tool(
  async ({ query, limit }) => {
    if (!query || query.trim().length === 0) {
      return formatStructuredContextForAgent([]);
    }
    try {
      const result = await searchForAgentStructured({
        query,
        mode: 'keyword',
        limit: limit || 10,
        threshold: ragConfig.SEARCH_MIN_THRESHOLD,
        fusionWeight: ragConfig.SEARCH_FUSION_WEIGHT,
        enableRerank: false,
        rerankerThreshold: undefined,
        useBm25: false,
        enableQueryPreprocess: false,
        enableExpansion: false,
        enableRewrite: false,
        enableMmr: false,
        mmrLambda: undefined,
      });
      // 关键词搜索没有语义分数，maxScore 来自融合后结果
      return formatStructuredContextForAgent(result.results, 3000, result.maxScore);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('关键词搜索失败:', message);
      return `<search_result><message>搜索失败: ${message}</message><chunks></chunks></search_result>`;
    }
  },
  {
    name: 'keyword_search',
    description: '关键词精确搜索知识库。适合查找特定术语、代码片段。返回带 chunk ID 的结构化结果。',
    schema: z.object({
      query: z.string().max(500).describe('关键词查询'),
      limit: z.number().int().min(1).max(50).default(10).describe('返回数量'),
    }),
  }
);

/**
 * Chunk 读取工具（读取完整内容）
 */
export const chunkReadTool = tool(
  async ({ chunkId }) => {
    try {
      const chunk = await getChunkById(chunkId);
      if (!chunk) {
        return `<chunk_read_result><error>未找到 chunk: ${chunkId}</error></chunk_read_result>`;
      }
      return `<chunk_read_result>
<chunk_id>${chunk.id}</chunk_id>
<document_title>${chunk.documentTitle}</document_title>
<source>${chunk.headingChain ? `${chunk.documentTitle} > ${chunk.headingChain}` : chunk.documentTitle}</source>
<content>${chunk.content}</content>
</chunk_read_result>`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Chunk读取失败:', message);
      return `<chunk_read_result><error>读取失败: ${message}</error></chunk_read_result>`;
    }
  },
  {
    name: 'chunk_read',
    description: '读取单个知识库片段的完整内容。用于深入了解搜索结果中的特定片段。',
    schema: z.object({
      chunkId: z.string().uuid().describe('Chunk ID（从搜索结果中获取）'),
    }),
  }
);

/**
 * 引用标注工具（cite_sources）
 */
export const citeSourcesTool = tool(
  async ({ chunkIds }) => {
    // 引用验证在 graph.ts 的 groundingGuardrailNode 中执行
    // 此工具仅记录引用意图
    return {
      cited: chunkIds,
      count: chunkIds.length,
      message: `已标注 ${chunkIds.length} 个来源引用`,
    };
  },
  {
    name: 'cite_sources',
    description: '标注回答中引用的知识库来源。回答知识库相关问题后，必须调用此工具标注用到的 chunk ID。',
    schema: z.object({
      chunkIds: z.array(z.string().uuid()).min(1).max(10).describe('引用的 chunk ID 列表'),
    }),
  }
);

/**
 * 一体化 RAG 工具：检索 → 返回结构化上下文 + 引用信息
 * 参考 cerid-ai 的 pkb_answer_with_citations 设计
 *
 * 与 semantic_search 的区别：
 * - 返回格式包含 confidence 置信度评分
 * - chunk 信息更详细，包含完整 content 和 citation hint
 * - 适合直接作为 LLM 上下文使用
 */
export const ragAnswerTool = tool(
  async ({ question, tags, limit }) => {
    if (!question || question.trim().length === 0) {
      return {
        context: '',
        sources: [],
        confidence: 0,
        message: '请提供查询内容',
      };
    }

    try {
      const result = await searchForAgentStructured({
        query: question,
        mode: 'semantic',
        tags: tags || undefined,
        limit: limit || 10,
        threshold: ragConfig.SEARCH_MIN_THRESHOLD,
        fusionWeight: ragConfig.SEARCH_FUSION_WEIGHT,
        enableRerank: ragConfig.RERANKER_ENABLED_BY_DEFAULT ?? true,
        rerankerThreshold: ragConfig.RERANKER_MIN_SCORE,
        useBm25: false,
        enableQueryPreprocess: ragConfig.QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT ?? false,
        enableExpansion: false,
        enableRewrite: true,
        enableMmr: ragConfig.MMR_ENABLED_BY_DEFAULT ?? false,
        mmrLambda: ragConfig.MMR_LAMBDA,
      });

      if (result.results.length === 0) {
        return {
          context: '知识库未找到相关内容',
          sources: [],
          confidence: 0,
          message: '未找到相关结果，请尝试其他查询方式',
          searched: true,
        };
      }

      // 构建上下文（使用更紧凑的格式）
      const contextParts: string[] = [];
      const sources: Array<{
        chunkId: string;
        documentTitle: string;
        headingChain?: string;
        score: number;
      }> = [];

      let totalChars = 0;
      const maxContextChars = 3000;

      for (const r of result.results) {
        const snippet = r.content.slice(0, 400);
        const sectionPath = r.headingChain
          ? `${r.documentTitle} > ${r.headingChain}`
          : r.documentTitle;

        sources.push({
          chunkId: r.id,
          documentTitle: r.documentTitle,
          headingChain: r.headingChain,
          score: r.score,
        });

        const contextBlock = `[${sectionPath}] (相关度: ${r.score.toFixed(2)})\n${snippet}\n`;
        const blockChars = contextBlock.length;

        if (totalChars + blockChars > maxContextChars) {
          break;
        }

        contextParts.push(contextBlock);
        totalChars += blockChars;
      }

      // 计算置信度（基于最高分数和结果数量）
      const maxScore = result.maxScore;
      const resultCount = result.results.length;
      const confidence = Math.min(maxScore * 0.7 + Math.min(resultCount / 10, 0.3), 1);

      // 低置信度提示
      const lowConfidenceHint = confidence < 0.4
        ? '\n\n【注意】检索置信度较低，回答可能不准确，建议补充其他信息来源。'
        : '';

      return {
        context: contextParts.join('\n') + lowConfidenceHint,
        sources,
        confidence: Math.round(confidence * 100) / 100,
        message: `找到 ${sources.length} 条相关内容，置信度 ${(confidence * 100).toFixed(0)}%`,
        searched: true,
        maxScore,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('RAG检索失败:', message);
      return {
        context: '',
        sources: [],
        confidence: 0,
        message: `检索失败: ${message}`,
        searched: true,
        error: message,
      };
    }
  },
  {
    name: 'rag_answer',
    description: '知识库一体化检索工具。输入问题，返回结构化上下文 + 来源引用信息。推荐用于知识库问答场景，返回结果可直接用于回答用户问题。',
    schema: z.object({
      question: z.string().max(500).describe('用户问题或查询内容'),
      tags: z.array(z.string().max(50)).max(10).optional().describe('按标签筛选'),
      limit: z.number().int().min(1).max(20).default(10).describe('返回数量'),
    }),
  }
);

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
    description: '创建新任务，需要用户确认。',
    schema: z.object({
      title: z.string().trim().min(1).max(200).describe('任务标题'),
      description: z.string().trim().max(500).optional().describe('任务描述'),
      priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
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
      date,
    });
    return toFinanceRecordDto(record);
  },
  {
    name: 'add_finance_record',
    description: '新增财务记录，需要用户确认。',
    schema: z.object({
      type: z.enum(['income', 'expense']).describe('记录类型'),
      amount: z.number().min(0).max(999999999.99).describe('金额'),
      description: z.string().trim().min(1).max(500).describe('描述'),
      category: z.string().trim().min(1).max(50).describe('分类'),
      date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).describe('日期，格式 YYYY-MM-DD'),
    }),
  }
);

export const updateTaskTool = tool(
  async ({ id, title, completed, priority, dueDate }) => {
    const existing = await findTaskById(id);
    if (!existing) {
      throw new Error(`未找到任务 ${id}`);
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
    description: '更新任务，需要用户确认。',
    schema: z.object({
      id: z.string().uuid().describe('任务 ID'),
      title: z.string().trim().min(1).max(200).optional().describe('新标题'),
      completed: z.boolean().optional().describe('完成状态'),
      priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
      dueDate: z.string().trim().max(30).optional().describe('截止日期'),
    }),
  }
);

export const deleteTaskTool = tool(
  async ({ id }) => {
    const existing = await findTaskById(id);
    if (!existing) {
      throw new Error(`未找到任务 ${id}`);
    }

    const deleted = await deleteTask(id);
    if (!deleted) {
      throw new Error(`删除任务失败: ${id}`);
    }
    return {
      id: deleted.id,
      deleted: true,
    };
  },
  {
    name: 'delete_task',
    description: '删除任务，需要用户确认。',
    schema: z.object({
      id: z.string().uuid().describe('任务 ID'),
    }),
  }
);

export interface ToolMetadata {
  requiresConfirmation: boolean;
}

export const toolMetadata: Record<string, ToolMetadata> = {
  query_tasks: { requiresConfirmation: false },
  get_task_stats: { requiresConfirmation: false },
  query_finance: { requiresConfirmation: false },
  get_finance_stats: { requiresConfirmation: false },
  search_knowledge: { requiresConfirmation: false },
  search_knowledge_rag: { requiresConfirmation: false },
  // 新增：细粒度 RAG 工具
  semantic_search: { requiresConfirmation: false },
  keyword_search: { requiresConfirmation: false },
  chunk_read: { requiresConfirmation: false },
  cite_sources: { requiresConfirmation: false },
  // 新增：一体化 RAG 工具
  rag_answer: { requiresConfirmation: false },
  // 写操作工具
  create_task: { requiresConfirmation: true },
  add_finance_record: { requiresConfirmation: true },
  update_task: { requiresConfirmation: true },
  delete_task: { requiresConfirmation: true },
};

export const allTools = [
  queryTasksTool,
  getTaskStatsTool,
  queryFinanceTool,
  getFinanceStatsTool,
  searchKnowledgeTool,
  searchKnowledgeRagTool,
  // 新增：细粒度 RAG 工具
  semanticSearchTool,
  keywordSearchTool,
  chunkReadTool,
  citeSourcesTool,
  // 新增：一体化 RAG 工具
  ragAnswerTool,
  // 写操作工具
  createTaskTool,
  addFinanceRecordTool,
  updateTaskTool,
  deleteTaskTool,
];

export function requiresConfirmation(toolName: string): boolean {
  return toolMetadata[toolName]?.requiresConfirmation ?? false;
}
