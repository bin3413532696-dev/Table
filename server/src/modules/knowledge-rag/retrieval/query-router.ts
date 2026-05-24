/**
 * Query Intent Router - 查询意图路由
 * 参考 cerid-ai surface_router.py 设计
 *
 * 根据查询特征判断意图类型，引导 Agent 选择合适的检索工具
 */

export type QueryIntent =
  | 'conceptual'   // 概念性问题 "什么是X" → 语义搜索
  | 'factual'      // 事实性问题 "X的值是多少" → 关键词搜索
  | 'mixed';       // 混合问题 → rag_answer

export interface IntentRouteResult {
  intent: QueryIntent;
  confidence: number;
  rationale: string;
  recommendedTool: 'rag_answer' | 'semantic_search' | 'keyword_search';
}

// 概念性问题模式（中文）
const CONCEPTUAL_PATTERNS_CN = [
  /^什么是/,
  /^什么叫/,
  /^何为/,
  /^解释/,
  /^介绍/,
  /^说明/,
  /^讲解/,
  /^概述/,
  /^简述/,
  /^描述/,
  /^谈谈/,
  /^聊聊/,
  /是什么$/,
  /的概念$/,
  /的含义$/,
  /的意义$/,
  /的原理$/,
  /的工作/,
  /如何实现/,
  /怎么实现/,
  /实现方式/,
];

// 概念性问题模式（英文）
const CONCEPTUAL_PATTERNS_EN = [
  /^what is/i,
  /^what are/i,
  /^explain/i,
  /^describe/i,
  /^overview/i,
  /^introduction/i,
  /^tell me about/i,
  /^how does/i,
  /^how to/i,
  /concept/i,
  /principle/i,
  /definition/i,
];

// 事实性问题模式（中文）
const FACTUAL_PATTERNS_CN = [
  /^多少/,
  /^几个/,
  /^哪/,
  /^谁/,
  /^何时/,
  /^什么时间/,
  /^什么时候/,
  /^具体/,
  /^精确/,
  /^值/,
  /^数值/,
  /^参数/,
  /^配置/,
  /^版本/,
  /^地址/,
  /^路径/,
  /^文件/,
  /^代码/,
  /^函数/,
  /^变量/,
  /^类/,
  /^方法/,
  /的值$/,
  /的参数$/,
  /的配置$/,
  /的版本$/,
  /的数量$/,
  /是多少$/,
];

// 事实性问题模式（英文）
const FACTUAL_PATTERNS_EN = [
  /^how many/i,
  /^how much/i,
  /^which/i,
  /^who/i,
  /^when/i,
  /^what time/i,
  /^exact/i,
  /^specific/i,
  /^value/i,
  /^number/i,
  /^count/i,
  /^parameter/i,
  /^config/i,
  /^version/i,
  /^path/i,
  /^file/i,
  /^code/i,
  /^function/i,
  /^variable/i,
  /^class/i,
  /^method/i,
];

/**
 * 分类查询意图
 */
export function classifyIntent(query: string): IntentRouteResult {
  const q = query.trim().toLowerCase();

  if (q.length < 4) {
    return {
      intent: 'mixed',
      confidence: 0.5,
      rationale: '查询过短，无法判断意图',
      recommendedTool: 'rag_answer',
    };
  }

  // 检查概念性模式
  for (const pattern of CONCEPTUAL_PATTERNS_CN) {
    if (pattern.test(query)) {
      return {
        intent: 'conceptual',
        confidence: 0.8,
        rationale: `匹配概念性模式: ${pattern.source}`,
        recommendedTool: 'semantic_search',
      };
    }
  }

  for (const pattern of CONCEPTUAL_PATTERNS_EN) {
    if (pattern.test(query)) {
      return {
        intent: 'conceptual',
        confidence: 0.8,
        rationale: `匹配概念性模式: ${pattern.source}`,
        recommendedTool: 'semantic_search',
      };
    }
  }

  // 检查事实性模式
  for (const pattern of FACTUAL_PATTERNS_CN) {
    if (pattern.test(query)) {
      return {
        intent: 'factual',
        confidence: 0.75,
        rationale: `匹配事实性模式: ${pattern.source}`,
        recommendedTool: 'keyword_search',
      };
    }
  }

  for (const pattern of FACTUAL_PATTERNS_EN) {
    if (pattern.test(query)) {
      return {
        intent: 'factual',
        confidence: 0.75,
        rationale: `匹配事实性模式: ${pattern.source}`,
        recommendedTool: 'keyword_search',
      };
    }
  }

  // 默认：混合问题
  return {
    intent: 'mixed',
    confidence: 0.6,
    rationale: '未匹配特定模式，使用一体化工具',
    recommendedTool: 'rag_answer',
  };
}

/**
 * 生成工具选择建议提示
 */
export function generateToolSelectionHint(query: string): string {
  const route = classifyIntent(query);

  const toolHints: Record<string, string> = {
    rag_answer: 'rag_answer 工具可一步完成检索和引用标注',
    semantic_search: 'semantic_search 适合概念性问题，返回结构化结果',
    keyword_search: 'keyword_search 适合精确术语查找',
  };

  return `【意图分析】
- 意图类型: ${route.intent}
- 推荐工具: ${route.recommendedTool}
- 理由: ${route.rationale}
- 提示: ${toolHints[route.recommendedTool]}`;
}

/**
 * 批量意图分类（用于多 query expansion）
 */
export function classifyIntentBatch(queries: string[]): IntentRouteResult[] {
  return queries.map(q => classifyIntent(q));
}