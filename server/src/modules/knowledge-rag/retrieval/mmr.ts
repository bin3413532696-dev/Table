import type { SearchResultDto } from '../dto';
import { ragConfig } from '../config';

/**
 * Token 估算（中英文混合）
 * 中文约 1.5 tokens/字符，英文约 0.25 tokens/字符（4 chars/token）
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const nonChineseChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + nonChineseChars * 0.25);
}

/**
 * 按 token 限制截断文本
 * @param text 原文本
 * @param maxTokens 最大 token 数（默认 400，留余量给 query）
 * @returns 截断后的文本
 */
export function truncateByTokens(text: string, maxTokens: number = ragConfig.RERANKER_MAX_TOKENS ?? 400): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  // 估算截断位置（保守估计）
  // 中文 1.5 tokens/char，英文 0.25 tokens/char，取中间值 1 作为保守估计
  const targetChars = Math.floor(maxTokens / 1);

  // 按字符截断，确保不超过 token 限制
  let truncated = text.slice(0, targetChars);
  while (estimateTokens(truncated) > maxTokens && truncated.length > 0) {
    truncated = truncated.slice(0, truncated.length - 10);
  }

  return truncated;
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  return norm > 0 ? dot / norm : 0;
}

/**
 * MMR（Maximal Marginal Relevance）多样性重排
 * @param results 已排序的结果列表
 * @param embeddings 结果的 embedding 向量（可选）
 * @param lambda 相关性权重 (0-1)，默认 0.7
 * @param topK 返回数量
 * @returns 重排后的结果
 */
export function mmrRerank(
  results: SearchResultDto[],
  embeddings: Map<string, number[]> | null,
  lambda: number = ragConfig.MMR_LAMBDA ?? 0.7,
  topK: number = 10
): SearchResultDto[] {
  if (!embeddings || embeddings.size === 0) {
    // 无 embedding 时，直接返回原始排序
    return results.slice(0, topK);
  }

  // 已选结果
  const selected: SearchResultDto[] = [];
  // 剩余候选
  const remaining = [...results];

  while (selected.length < topK && remaining.length > 0) {
    let maxScore = -Infinity;
    let maxIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const candidateEmbedding = embeddings.get(candidate.id);

      // 计算与已选结果的最大相似度（惩罚重复）
      let maxSimilarity = 0;
      if (candidateEmbedding && selected.length > 0) {
        for (const sel of selected) {
          const selEmbedding = embeddings.get(sel.id);
          if (selEmbedding) {
            const similarity = cosineSimilarity(candidateEmbedding, selEmbedding);
            maxSimilarity = Math.max(maxSimilarity, similarity);
          }
        }
      }

      // MMR 分数 = lambda * relevance - (1-lambda) * max_similarity
      const mmrScore = lambda * candidate.score - (1 - lambda) * maxSimilarity;

      if (mmrScore > maxScore) {
        maxScore = mmrScore;
        maxIdx = i;
      }
    }

    selected.push(remaining[maxIdx]);
    remaining.splice(maxIdx, 1);
  }

  return selected;
}