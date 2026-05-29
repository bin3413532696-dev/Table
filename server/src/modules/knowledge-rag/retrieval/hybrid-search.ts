import { semanticSearch, keywordSearch, bm25Search, getChunkEmbeddingsBatch, findParentChunksByIds } from '../repository';
import { fuseResults, crossEncoderRerank } from './reranker';
import { mmrRerank } from './mmr';
import { embedQuery } from '../indexing/embedder';
import { preprocessQuery } from './query-preprocessor';
import type { HybridSearchInput } from '../schema';
import type { SearchResultDto } from '../dto';
import { ragConfig } from '../config';
import { getCurrentUserId } from '../../../shared/user-context';

// 混合搜索结果
export interface HybridSearchResult {
  results: SearchResultDto[];
  semanticCount: number;
  keywordCount: number;
  queryEmbeddingTimeMs: number;
  searchTimeMs: number;
  rerankTimeMs?: number;
  preprocessTimeMs?: number;
  mmrTimeMs?: number;
  // 新增：原始语义搜索最高分数（用于 Retrieval Grader，不受 RRF 融合影响）
  originalSemanticMaxScore: number;
}

// 执行混合搜索
export async function hybridSearch(params: HybridSearchInput): Promise<HybridSearchResult> {
  const startTime = Date.now();

  // 查询预处理（可选）
  let queriesToSearch: string[] = params.query ? [params.query] : [];
  let preprocessTimeMs = 0;

  if (params.enableQueryPreprocess && ragConfig.QUERY_PREPROCESSOR_ENABLED && params.query) {
    try {
      const preprocessResult = await preprocessQuery(params.query, {
        enableExpansion: params.enableExpansion,
        enableRewrite: params.enableRewrite ?? ragConfig.QUERY_REWRITE_ENABLED,
        expandCount: ragConfig.QUERY_EXPANSION_COUNT,
      });
      queriesToSearch = preprocessResult.expandedQueries;
      preprocessTimeMs = preprocessResult.preprocessTimeMs;
    } catch (error) {
      console.warn('Query preprocessing failed, using original query:', error);
      queriesToSearch = [params.query];
    }
  }

  // 收集所有搜索结果
  let allSemanticResults: SearchResultDto[] = [];
  let allKeywordResults: SearchResultDto[] = [];
  let queryEmbeddingTimeMs = 0;

  // 对每个查询执行搜索
  for (const query of queriesToSearch) {
    if (!query || query.trim().length === 0) continue;

    // 语义搜索
    const embedStart = Date.now();
    const queryEmbedding = await embedQuery(query);
    queryEmbeddingTimeMs += Date.now() - embedStart;

    const semanticRes = await semanticSearch(queryEmbedding, params);
    allSemanticResults.push(...semanticRes);

    // 关键词搜索（支持 BM25 或 pg_trgm）
    const keywordRes = params.useBm25 && ragConfig.BM25_ENABLED
      ? await bm25Search(query, params)
      : await keywordSearch(query, params);
    allKeywordResults.push(...keywordRes);
  }

  // 记录原始语义搜索最高分数（用于 Retrieval Grader）
  // 在融合前计算，避免 RRF 分数干扰
  const originalSemanticMaxScore = allSemanticResults.length > 0
    ? Math.max(...allSemanticResults.map(r => r.score))
    : 0;

  // 融合结果（去重）
  let fusedResults = fuseResults(allSemanticResults, allKeywordResults, params.fusionWeight);

  // MMR 多样性后处理（可选，在 rerank 之前）
  let mmrTimeMs = 0;
  if (params.enableMmr && ragConfig.MMR_ENABLED && params.query) {
    try {
      // 获取 embedding 用于 MMR 相似度计算
      const chunkIds = fusedResults.slice(0, Math.min(Math.max(ragConfig.RERANKER_CANDIDATE_MIN ?? 50, params.limit * 5), ragConfig.RERANKER_CANDIDATE_MAX ?? 100)).map(r => r.id);
      const embeddings = await getChunkEmbeddingsBatch(chunkIds);

      const mmrStart = Date.now();
      fusedResults = mmrRerank(
        fusedResults,
        embeddings,
        params.mmrLambda ?? ragConfig.MMR_LAMBDA,
        Math.min(Math.max(ragConfig.RERANKER_CANDIDATE_MIN ?? 50, params.limit * 5), ragConfig.RERANKER_CANDIDATE_MAX ?? 100)
      );
      mmrTimeMs = Date.now() - mmrStart;
    } catch (error) {
      console.warn('MMR 多样性后处理失败，使用原始排序:', error);
    }
  }

  // Cross-Encoder Rerank（可选）
  let rerankTimeMs = 0;
  if (params.enableRerank && ragConfig.RERANKER_ENABLED && params.query) {
    // 召回更多候选用于 rerank，至少 50 个，最多 100 个
    const rerankCandidates = fusedResults.slice(0, Math.min(Math.max(ragConfig.RERANKER_CANDIDATE_MIN ?? 50, params.limit * 5), ragConfig.RERANKER_CANDIDATE_MAX ?? 100));
    const rerankResult = await crossEncoderRerank(params.query, rerankCandidates, params.limit);
    fusedResults = rerankResult.results;
    rerankTimeMs = rerankResult.rerankTimeMs;
  }

  // 应用 threshold 和 limit
  // 对于 reranked 结果，使用独立的 reranker threshold
  const rerankerThreshold = params.rerankerThreshold ?? ragConfig.RERANKER_MIN_SCORE ?? 0.3;

  const filteredResults = fusedResults
    .filter(r => {
      // reranked 结果使用 reranker threshold
      if (r.source === 'reranked') {
        return r.score >= rerankerThreshold;
      }
      // 其他结果使用原始 threshold
      return r.score >= params.threshold;
    })
    .slice(0, params.limit);

  // === 小块大块架构：查询关联的大块内容 ===
  // 收集所有小块的 parentId
  const parentIds = filteredResults
    .filter(r => r.parentId)
    .map(r => r.parentId!)
    .filter(id => id !== null);

  // 批量查询大块
  let parentContentMap: Map<string, string> = new Map();
  if (parentIds.length > 0) {
    try {
      const userId = getCurrentUserId();
      const parentChunks = await findParentChunksByIds(userId, parentIds);
      parentContentMap = new Map(parentChunks.map(p => [p.id, p.content]));
    } catch (error) {
      console.warn('[检索] 查询大块内容失败:', error);
    }
  }

  // 将大块内容添加到搜索结果
  const results = filteredResults.map(r => ({
    ...r,
    parentContent: r.parentId ? parentContentMap.get(r.parentId) : undefined,
    chunkType: 'small',
  }));

  return {
    results,
    semanticCount: allSemanticResults.length,
    keywordCount: allKeywordResults.length,
    queryEmbeddingTimeMs,
    searchTimeMs: Date.now() - startTime,
    rerankTimeMs,
    preprocessTimeMs,
    mmrTimeMs,
    originalSemanticMaxScore,
  };
}

// 搜索建议（基于分块内容）
export async function searchSuggestions(query: string, limit: number = 5): Promise<string[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const results = await keywordSearch(query, {
    query,
    mode: 'keyword',
    limit: limit * 2,
    threshold: 0.1,
    fusionWeight: 0.5,
    enableRerank: false,
    rerankerThreshold: undefined,
    useBm25: false,
    enableQueryPreprocess: false,
    enableExpansion: false,
    enableRewrite: false,
    enableMmr: false,
    mmrLambda: undefined,
  });

  // 从分块内容中提取建议词
  const suggestions: string[] = [];
  const queryLower = query.toLowerCase();

  for (const result of results) {
    // 从内容中找到包含查询词的句子
    const sentences = result.content.split(/[。\n]/).filter(s => s.length > 10);
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(queryLower) && !suggestions.includes(sentence)) {
        suggestions.push(sentence.slice(0, 100));
        if (suggestions.length >= limit) break;
      }
    }
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}