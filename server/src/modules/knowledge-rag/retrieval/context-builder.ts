import type { SearchResultDto } from '../dto';

// LLM 上下文组装结果
export interface ContextBuildResult {
  context: string;
  sources: Array<{
    documentId: string;
    documentTitle: string;
    headingChain?: string;
    chunkIndex: number;
    snippet: string;
  }>;
  totalTokens: number;
  coverageMetadata?: {
    facetsTotal: number;
    facetsCovered: number;
    coverageRatio: number;
    facets: string[];
  };
}

/**
 * 精确 Token 估算（中英文混合）
 * - 中文：~1.5 tokens/字符
 * - 英文：~0.25 tokens/字符（4 chars/token）
 */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const nonChineseChars = text.length - chineseChars;

  return Math.ceil(chineseChars * 1.5 + nonChineseChars * 0.25);
}

// =====================================================
// Facet Extraction - 从查询提取子问题
// 参考 cerid-ai context_assembler.py
// =====================================================

const MIN_FACET_LENGTH = 4;

/**
 * 从查询中提取多个 facet（子问题/关注点）
 * 用于智能上下文组装时跟踪覆盖情况
 */
export function extractFacets(query: string): string[] {
  if (!query || query.trim().length < MIN_FACET_LENGTH) {
    return [query.trim()];
  }

  // 中文：按逗号、问号、顿号分割
  // 英文：按 and/or/also/plus 及逗号、分号、问号分割
  const parts = query.split(
    /[,，;；?？、]|(?:\s+(?:and|or|also|additionally|plus|as well as|以及|和|与|还有|并且)\s+)/i
  );

  const facets: string[] = [];
  for (const part of parts) {
    const cleaned = part.trim();
    if (cleaned.length >= MIN_FACET_LENGTH) {
      facets.push(cleaned);
    }
  }

  // 如果没有提取到有效 facet，使用原始查询
  return facets.length > 0 ? facets : [query.trim()];
}

/**
 * 计算 facet 与文档内容的覆盖率
 * 基于关键词重叠度（简化版，不依赖 NLP）
 */
function facetCoverage(docContent: string, facet: string): number {
  const docTerms = new Set(
    docContent.toLowerCase()
      .replace(/[^\w一-鿿]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
  );
  const facetTerms = facet.toLowerCase()
    .replace(/[^\w一-鿿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  if (facetTerms.length === 0) return 0;

  let matchCount = 0;
  for (const term of facetTerms) {
    if (docTerms.has(term)) matchCount++;
  }

  return matchCount / facetTerms.length;
}

// =====================================================
// Facet-aware 智能上下文组装
// =====================================================

/**
 * Facet-aware 智能上下文组装
 * 三阶段策略（参考 cerid-ai context_assembler.py）:
 *   Phase 1: Facet Extraction - 从查询提取子问题
 *   Phase 2: Greedy Set-Cover - 选择覆盖最多 facet 的文档
 *   Phase 3: Coherence Padding - 填充剩余 budget
 */
export function intelligentBuildContext(
  results: SearchResultDto[],
  query: string,
  maxTokens: number = 4000,
  format: 'plain' | 'markdown' = 'markdown'
): ContextBuildResult {
  if (results.length === 0) {
    return { context: '', sources: [], totalTokens: 0 };
  }

  const facets = extractFacets(query);
  const facetsCovered = new Array(facets.length).fill(false);
  const selectedIndices: number[] = [];
  let totalTokens = 0;

  // 按分数降序排列
  const sortedResults = [...results].sort((a, b) => b.score - a.score);

  // 预计算每个结果的 snippet 和 token 数
  const resultMeta = sortedResults.map(r => {
    const snippet = r.content.slice(0, 500);
    const sectionPath = r.headingChain
      ? `${r.documentTitle} > ${r.headingChain}`
      : r.documentTitle;
    const headerTokens = estimateTokens(format === 'markdown'
      ? `### 来源: ${sectionPath}\n\n`
      : `[来源: ${sectionPath}]\n`);
    const snippetTokens = estimateTokens(snippet);
    return { snippet, sectionPath, totalTokens: headerTokens + snippetTokens };
  });

  // Phase 2: Greedy Set-Cover
  // 选择覆盖最多未覆盖 facet 的文档
  const remaining = new Set(sortedResults.map((_, i) => i));

  for (let round = 0; round < sortedResults.length; round++) {
    let bestIdx = -1;
    let bestScore = -1;

    for (const idx of remaining) {
      const r = sortedResults[idx];
      const relevance = r.score;

      // 计算该文档对未覆盖 facet 的覆盖率
      let coverageBonus = 0;
      for (let fi = 0; fi < facets.length; fi++) {
        if (!facetsCovered[fi]) {
          coverageBonus += facetCoverage(r.content, facets[fi]);
        }
      }

      const score = relevance + coverageBonus * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;

    // 检查 token 预算
    if (totalTokens + resultMeta[bestIdx].totalTokens > maxTokens) {
      // 预算不足，跳过此文档但继续尝试更小的
      remaining.delete(bestIdx);
      continue;
    }

    selectedIndices.push(bestIdx);
    remaining.delete(bestIdx);
    totalTokens += resultMeta[bestIdx].totalTokens;

    // 更新 facet 覆盖状态（阈值 30%）
    for (let fi = 0; fi < facets.length; fi++) {
      if (!facetsCovered[fi] && facetCoverage(sortedResults[bestIdx].content, facets[fi]) >= 0.3) {
        facetsCovered[fi] = true;
      }
    }

    // 所有 facet 已覆盖，可以进入 padding 阶段
    if (facetsCovered.every(c => c)) break;
  }

  // Phase 3: Coherence Padding
  // 用剩余预算填充高分文档
  for (const idx of [...remaining].sort((a, b) => sortedResults[b].score - sortedResults[a].score)) {
    if (selectedIndices.includes(idx)) continue;

    if (totalTokens + resultMeta[idx].totalTokens > maxTokens) {
      continue;
    }

    selectedIndices.push(idx);
    totalTokens += resultMeta[idx].totalTokens;
  }

  // 按原始分数排序输出
  selectedIndices.sort((a, b) => sortedResults[b].score - sortedResults[a].score);

  // 构建输出
  const sources: ContextBuildResult['sources'] = [];
  const contextParts: string[] = [];

  for (const idx of selectedIndices) {
    const r = sortedResults[idx];
    const meta = resultMeta[idx];

    sources.push({
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      headingChain: r.headingChain,
      chunkIndex: r.chunkIndex,
      snippet: meta.snippet,
    });

    if (format === 'markdown') {
      contextParts.push(
        `### 来源: ${meta.sectionPath} (相关度: ${r.score.toFixed(3)})\n\n${meta.snippet}\n\n`
      );
    } else {
      contextParts.push(
        `[来源: ${meta.sectionPath}]\n${meta.snippet}\n\n`
      );
    }
  }

  const coveredCount = facetsCovered.filter(c => c).length;

  return {
    context: contextParts.join(''),
    sources,
    totalTokens,
    coverageMetadata: {
      facetsTotal: facets.length,
      facetsCovered: coveredCount,
      coverageRatio: facets.length > 0 ? Math.round((coveredCount / facets.length) * 100) / 100 : 1,
      facets,
    },
  };
}

// 组装 LLM 上下文（保留原接口兼容）
export function buildLLMContext(
  results: SearchResultDto[],
  maxTokens: number = 4000,
  format: 'plain' | 'markdown' = 'markdown'
): ContextBuildResult {
  const sources: ContextBuildResult['sources'] = [];
  const contextParts: string[] = [];

  let totalTokens = 0;

  for (const result of results) {
    const snippet = result.content.slice(0, 500);
    const snippetTokens = estimateTokens(snippet);

    // 构建完整路径（文档标题 > 章节路径）
    const sectionPath = result.headingChain
      ? `${result.documentTitle} > ${result.headingChain}`
      : result.documentTitle;

    const headerTokens = estimateTokens(`### 来源: ${sectionPath}\n\n`);

    if (totalTokens + snippetTokens + headerTokens > maxTokens) {
      break;
    }

    sources.push({
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      headingChain: result.headingChain,
      chunkIndex: result.chunkIndex,
      snippet,
    });

    if (format === 'markdown') {
      contextParts.push(
        `### 来源: ${sectionPath} (相关度: ${result.score.toFixed(3)})\n\n${snippet}\n\n`
      );
    } else {
      contextParts.push(
        `[来源: ${sectionPath}]\n${snippet}\n\n`
      );
    }

    totalTokens += snippetTokens + headerTokens;
  }

  const context = contextParts.join('');

  return {
    context,
    sources,
    totalTokens,
  };
}

// 格式化上下文为 Agent 提示词
export function formatContextForAgent(results: SearchResultDto[]): string {
  if (results.length === 0) {
    return '知识库搜索未找到相关内容。';
  }

  const buildResult = buildLLMContext(results, 3000, 'markdown');

  return `以下是知识库搜索结果，共找到 ${results.length} 条相关内容：

${buildResult.context}

请基于以上知识库内容回答用户问题。如果知识库内容不足以回答问题，请明确告知用户。`;
}

/**
 * 格式化结构化上下文（XML 格式，保留 chunk ID）
 * 用于 semantic_search / keyword_search 工具返回值
 */
export function formatStructuredContextForAgent(
  results: SearchResultDto[],
  maxTokens: number = 3000,
  originalSemanticMaxScore?: number
): string {
  if (results.length === 0) {
    return `<search_result>
<message>知识库搜索未找到相关内容</message>
<max_score>0</max_score>
<original_semantic_max_score>0</original_semantic_max_score>
<chunks></chunks>
</search_result>`;
  }

  // 按分数降序排列，确保最高分在最前
  const sortedResults = [...results].sort((a, b) => b.score - a.score);

  // 使用传入的原始语义分数（如果有），否则从结果中计算（融合后分数）
  const maxScore = originalSemanticMaxScore ?? sortedResults[0].score;

  let totalTokens = 0;
  const chunks: string[] = [];

  for (const result of sortedResults) {
    const snippet = result.content.slice(0, 500);
    const snippetTokens = estimateTokens(snippet);

    const sectionPath = result.headingChain
      ? `${result.documentTitle} > ${result.headingChain}`
      : result.documentTitle;

    const chunkXml = `<chunk id="${result.id}">
<source>${sectionPath}</source>
<score>${result.score.toFixed(3)}</score>
<content>${snippet}</content>
</chunk>`;
    const chunkTokens = estimateTokens(chunkXml);

    if (totalTokens + chunkTokens > maxTokens) {
      break;
    }

    chunks.push(chunkXml);
    totalTokens += chunkTokens;
  }

  return `<search_result>
<message>找到 ${chunks.length} 条相关内容</message>
<max_score>${maxScore.toFixed(3)}</max_score>
<original_semantic_max_score>${(originalSemanticMaxScore ?? 0).toFixed(3)}</original_semantic_max_score>
<chunks>
${chunks.join('\n')}
</chunks>
<hint>回答问题时请使用 cite_sources(chunkIds) 工具标注引用的 chunk ID</hint>
</search_result>`;
}

// 格式化单个结果
export function formatSingleResult(result: SearchResultDto): string {
  return `[${result.documentTitle}] (相关度: ${(result.score * 100).toFixed(1)}%)
${result.content.slice(0, 300)}${result.content.length > 300 ? '...' : ''}`;
}