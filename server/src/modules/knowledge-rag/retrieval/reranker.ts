import type { SearchResultDto } from '../dto';
import { ragConfig } from '../config';
import { truncateByTokens } from './mmr';

// RRF（Reciprocal Rank Fusion）融合算法
export function fuseResults(
  semanticResults: SearchResultDto[],
  keywordResults: SearchResultDto[],
  fusionWeight: number = ragConfig.SEARCH_FUSION_WEIGHT
): SearchResultDto[] {
  const k = ragConfig.SEARCH_RRF_K;

  const hasSemantic = semanticResults.length > 0;
  const hasKeyword = keywordResults.length > 0;

  // 单路为空时，直接返回另一路结果，保留原始分数
  // 修复：不再用 rank-based normalization 覆盖原始相似度分数
  if (!hasKeyword && hasSemantic) {
    return semanticResults
      .slice()
      .sort((a, b) => b.score - a.score);
  }

  if (!hasSemantic && hasKeyword) {
    return keywordResults
      .slice()
      .sort((a, b) => b.score - a.score);
  }

  if (!hasSemantic && !hasKeyword) {
    return [];
  }

  // 双路都有结果：加权 RRF 融合
  const semanticRanks = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRanks.set(r.id, i + 1));

  const keywordRanks = new Map<string, number>();
  keywordResults.forEach((r, i) => keywordRanks.set(r.id, i + 1));

  const allIds = new Set([...semanticRanks.keys(), ...keywordRanks.keys()]);

  const fused: SearchResultDto[] = [];

  for (const id of allIds) {
    const semanticRank = semanticRanks.get(id);
    const keywordRank = keywordRanks.get(id);

    const semanticScore = semanticRank !== undefined
      ? fusionWeight / (k + semanticRank)
      : 0;
    const keywordScore = keywordRank !== undefined
      ? (1 - fusionWeight) / (k + keywordRank)
      : 0;

    const rrfScore = semanticScore + keywordScore;

    // 根据结果实际参与的路动态计算归一化分母
    let maxRrfScore: number;
    if (semanticRank !== undefined && keywordRank !== undefined) {
      // 同时出现在两路中
      maxRrfScore = fusionWeight / (k + 1) + (1 - fusionWeight) / (k + 1);
    } else if (semanticRank !== undefined) {
      // 仅在语义搜索中
      maxRrfScore = fusionWeight / (k + 1);
    } else {
      // 仅在关键词搜索中
      maxRrfScore = (1 - fusionWeight) / (k + 1);
    }

    const normalizedScore = Math.min(1, rrfScore / maxRrfScore);

    const baseResult = semanticResults.find(r => r.id === id) ?? keywordResults.find(r => r.id === id)!;

    fused.push({
      ...baseResult,
      score: normalizedScore,
      source: semanticRank !== undefined && keywordRank !== undefined ? 'hybrid' : baseResult.source,
    });
  }

  return fused.sort((a, b) => b.score - a.score);
}

// 线性融合（当分数已归一化时使用）
export function linearFusion(
  semanticResults: SearchResultDto[],
  keywordResults: SearchResultDto[],
  fusionWeight: number = ragConfig.SEARCH_FUSION_WEIGHT
): SearchResultDto[] {
  // 归一化分数到 0-1 范围
  const normalizeScore = (results: SearchResultDto[]): SearchResultDto[] => {
    if (results.length === 0) return results;
    const maxScore = Math.max(...results.map(r => r.score), 1);
    return results.map(r => ({ ...r, score: r.score / maxScore }));
  };

  const normalizedSemantic = normalizeScore(semanticResults);
  const normalizedKeyword = normalizeScore(keywordResults);

  // 合并结果
  const combined = new Map<string, SearchResultDto>();

  for (const r of normalizedSemantic) {
    combined.set(r.id, {
      ...r,
      score: fusionWeight * r.score,
    });
  }

  for (const r of normalizedKeyword) {
    const existing = combined.get(r.id);
    if (existing) {
      existing.score += (1 - fusionWeight) * r.score;
      existing.source = 'hybrid';
    } else {
      combined.set(r.id, {
        ...r,
        score: (1 - fusionWeight) * r.score,
      });
    }
  }

  return Array.from(combined.values()).sort((a, b) => b.score - a.score);
}

// =====================================================
// Cross-Encoder Reranker（新增）
// =====================================================

/**
 * Cross-Encoder Rerank 结果类型
 */
export interface RerankResult {
  results: SearchResultDto[];
  rerankTimeMs: number;
}

/**
 * 获取 Reranker 客户端（复用 Provider 系统）
 */
async function getRerankerClient(): Promise<{
  baseUrl: string;
  apiKey: string;
  rerankerModel: string;
  headers?: Record<string, string>;
} | null> {
  try {
    const { getActiveProviderForCurrentUser } = await import('../../providers/service');
    const provider = await getActiveProviderForCurrentUser();

    if (!provider || !provider.rerankerModel) {
      return null;
    }

    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      rerankerModel: provider.rerankerModel,
      headers: provider.headers,
    };
  } catch {
    return null;
  }
}

/**
 * Cross-Encoder 重排序
 * @param query 查询文本
 * @param results 初始检索结果（语义+关键词融合后的结果）
 * @param topN 返回前 N 个结果
 * @returns 重排序后的结果
 */
export async function crossEncoderRerank(
  query: string,
  results: SearchResultDto[],
  topN: number = ragConfig.RERANKER_TOP_N
): Promise<RerankResult> {
  const startTime = Date.now();

  // 检查是否启用 reranker
  if (!ragConfig.RERANKER_ENABLED) {
    return { results: results.slice(0, topN), rerankTimeMs: 0 };
  }

  // 检查是否有结果
  if (results.length === 0) {
    return { results: [], rerankTimeMs: 0 };
  }

  // 获取 reranker 配置
  const rerankerClient = await getRerankerClient();
  if (!rerankerClient) {
    return { results: results.slice(0, topN), rerankTimeMs: Date.now() - startTime };
  }

  try {
    // 提取文档内容（按 token 截断，避免超出 reranker 512 token 限制）
    const documents = results.map(r => truncateByTokens(r.content));

    // 调用 reranker API（支持 Cohere Rerank 或 OpenAI-compatible 格式）
    const response = await fetch(`${rerankerClient.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${rerankerClient.apiKey}`,
        'Content-Type': 'application/json',
        ...rerankerClient.headers,
      },
      body: JSON.stringify({
        model: rerankerClient.rerankerModel,
        query,
        documents,
        top_n: Math.min(topN, results.length),
        return_documents: false,
      }),
      signal: AbortSignal.timeout(ragConfig.RERANKER_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`Reranker API 失败: ${response.status} ${response.statusText}`);
      return { results: results.slice(0, topN), rerankTimeMs: Date.now() - startTime };
    }

    const data: any = await response.json();

    // Cohere Rerank API 返回格式: { results: [{ index: number, relevance_score: number }] }
    const rerankScores: { index: number; relevance_score: number }[] = data.results || [];

    // 按 rerank 分数重新排序
    const rerankedResults = rerankScores
      .map((r) => ({
        ...results[r.index],
        score: r.relevance_score ?? 0,
        source: 'reranked' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return {
      results: rerankedResults,
      rerankTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.warn('Cross-Encoder Rerank 失败，使用原始排序:', error);
    return { results: results.slice(0, topN), rerankTimeMs: Date.now() - startTime };
  }
}