import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ragConfig } from '../config';

/**
 * Query 预处理结果
 */
export interface QueryPreprocessResult {
  originalQuery: string;
  expandedQueries: string[];
  preprocessTimeMs: number;
}

/**
 * 中文停用词列表
 */
const CHINESE_STOPWORDS = [
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '什么',
  '怎么', '如何', '为什么', '为什么', '吗', '呢', '啊', '吧', '可以',
  '能够', '应该', '需要', '想', '请', '谢谢', '您好', '你好',
];

/**
 * Query Rewrite（改写查询以提高检索质量）
 * 去除停用词，提取核心关键词
 */
export async function rewriteQuery(query: string): Promise<string> {
  // 分词（简单实现：按空格和标点分割）
  const tokens = query.split(/[\s，。；：！？、]+/).filter(t => t.length > 0);

  // 过滤停用词
  const filteredTokens = tokens.filter(
    t => !CHINESE_STOPWORDS.includes(t.toLowerCase()) && t.length > 1
  );

  // 如果过滤后为空，返回原始查询
  if (filteredTokens.length === 0) {
    return query.trim();
  }

  return filteredTokens.join(' ').trim();
}

/**
 * Multi-Query Expansion（生成多个语义相关查询）
 * 使用 LLM 生成多个查询变体
 */
export async function multiQueryExpansion(
  query: string,
  expandCount: number = ragConfig.QUERY_EXPANSION_COUNT,
  timeoutMs: number = ragConfig.QUERY_PREPROCESSOR_TIMEOUT_MS
): Promise<QueryPreprocessResult> {
  const startTime = Date.now();

  try {
    // 获取 Provider 配置（复用 Agent 的 LLM）
    const { getRequiredActiveProviderForCurrentUser } = await import('../../providers/service');
    const { createStreamingChatModel } = await import('../../agent/langgraph/chatModel');

    const provider = await getRequiredActiveProviderForCurrentUser();

    // 创建 ChatModel（复用 Agent 的 LLM 配置）
    const chatModel = createStreamingChatModel(
      {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers,
      },
      provider.model || 'gpt-3.5-turbo'
    );

    // 构建 Prompt
    const systemPrompt = `你是一个搜索查询优化助手。给定用户的原始查询，生成 ${expandCount} 个语义相关但表述不同的查询变体。

规则：
1. 保持原始查询的核心意图
2. 使用不同的词汇和表述方式
3. 覆盖不同的搜索角度（精确匹配、同义词、上下文）
4. 每个查询独立一行，不要编号，不要解释

输出格式示例：
原始查询："Python 异步编程最佳实践"
Python asyncio 使用指南
Python 协程并发模式
Python 异步任务调度方法`;

    const userPrompt = `原始查询："${query}"

生成 ${expandCount} 个扩展查询（每行一个）：`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    // 调用 LLM（带超时）
    const responsePromise = chatModel.invoke(messages);

    // 超时处理
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Query expansion timeout')), timeoutMs);
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    const content = typeof response.content === 'string'
      ? response.content
      : response.content.map((c: any) => c.text || '').join('');

    // 解析扩展查询
    const expandedQueries = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('原始查询') && !line.startsWith('生成'))
      .slice(0, expandCount);

    // 确保至少包含原始查询
    if (expandedQueries.length === 0) {
      expandedQueries.push(query);
    }

    // 将原始查询添加到列表开头
    if (!expandedQueries.includes(query)) {
      expandedQueries.unshift(query);
    }

    return {
      originalQuery: query,
      expandedQueries,
      preprocessTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.warn('Multi-query expansion failed, using original query:', error);
    return {
      originalQuery: query,
      expandedQueries: [query],
      preprocessTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Query 预处理 Pipeline（组合多种策略）
 */
export async function preprocessQuery(
  query: string,
  options: {
    enableExpansion?: boolean;
    enableRewrite?: boolean;
    expandCount?: number;
  } = {}
): Promise<QueryPreprocessResult> {
  const startTime = Date.now();

  let processedQuery = query;
  let expandedQueries: string[] = [];

  // Step 1: Query Rewrite（可选）
  if (options.enableRewrite) {
    processedQuery = await rewriteQuery(query);
  }

  // Step 2: Multi-Query Expansion（可选）
  if (options.enableExpansion) {
    const expansionResult = await multiQueryExpansion(
      processedQuery,
      options.expandCount || ragConfig.QUERY_EXPANSION_COUNT
    );
    expandedQueries = expansionResult.expandedQueries;
  } else {
    expandedQueries = [processedQuery];
  }

  return {
    originalQuery: query,
    expandedQueries,
    preprocessTimeMs: Date.now() - startTime,
  };
}