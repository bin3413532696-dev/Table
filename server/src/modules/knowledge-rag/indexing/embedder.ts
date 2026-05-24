import { OpenAIEmbeddings } from '@langchain/openai';
import { findEmbeddingCacheBatch, storeEmbeddingCache } from '../repository';
import { ragConfig } from '../config';

// =====================================================
// Query Embedding 缓存（内存缓存，避免重复 API 调用）
// =====================================================

interface QueryCacheEntry {
  embedding: number[];
  timestamp: number;
  model: string;
}

// 内存缓存（key: query + model）
const queryEmbeddingCache = new Map<string, QueryCacheEntry>();

// 缓存 TTL（默认 1 小时）
const QUERY_CACHE_TTL_MS = ragConfig.CACHE_QUERY_TTL_SECONDS * 1000;

/**
 * 生成缓存 key（query + model hash）
 */
function getQueryCacheKey(query: string, model: string): string {
  // 使用简单 hash 避免长 key
  const queryHash = query.trim().toLowerCase().slice(0, 100);
  return `${model}:${queryHash}`;
}

/**
 * 从缓存获取 query embedding
 */
function getQueryEmbeddingFromCache(query: string, model: string): number[] | null {
  const key = getQueryCacheKey(query, model);
  const entry = queryEmbeddingCache.get(key);

  if (!entry) return null;

  // 检查 TTL
  if (Date.now() - entry.timestamp > QUERY_CACHE_TTL_MS) {
    queryEmbeddingCache.delete(key);
    return null;
  }

  return entry.embedding;
}

/**
 * 存储 query embedding 到缓存
 */
function setQueryEmbeddingToCache(query: string, model: string, embedding: number[]): void {
  const key = getQueryCacheKey(query, model);
  queryEmbeddingCache.set(key, {
    embedding,
    timestamp: Date.now(),
    model,
  });

  // 清理过期缓存（简单策略：每 100 次写入清理一次）
  if (queryEmbeddingCache.size > 100) {
    const now = Date.now();
    for (const [k, e] of queryEmbeddingCache.entries()) {
      if (now - e.timestamp > QUERY_CACHE_TTL_MS) {
        queryEmbeddingCache.delete(k);
      }
    }
  }
}

/**
 * 清理 query embedding 缓存（可用于强制刷新）
 */
export function clearQueryEmbeddingCache(): void {
  queryEmbeddingCache.clear();
}

// =====================================================
// 超时和重试机制
// =====================================================

// 超时包装函数
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operationName} 超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// 重试包装函数
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最后一次尝试不等待
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`${operationName} 第 ${attempt + 1} 次失败，${delayMs}ms 后重试:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`${operationName} 失败，已重试 ${maxRetries} 次: ${lastError?.message}`);
}

// Embedding 生成器类
export class KnowledgeEmbedder {
  private embeddings: OpenAIEmbeddings;
  private embeddingModel: string;
  private dimensions: number;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(apiKey: string, baseUrl?: string, embeddingModel?: string) {
    this.embeddingModel = embeddingModel || ragConfig.EMBEDDING_MODEL;
    this.dimensions = ragConfig.EMBEDDING_DIMENSIONS;
    this.timeoutMs = ragConfig.EMBEDDING_TIMEOUT_MS;
    this.maxRetries = ragConfig.EMBEDDING_MAX_RETRIES;

    this.embeddings = new OpenAIEmbeddings({
      model: this.embeddingModel,
      dimensions: this.dimensions,
      apiKey,
      configuration: baseUrl ? { baseURL: baseUrl } : undefined,
    });
  }

  // 生成查询 Embedding（带超时和重试，优先使用缓存）
  async embedQuery(query: string): Promise<number[]> {
    // 检查缓存
    const cached = getQueryEmbeddingFromCache(query, this.embeddingModel);
    if (cached) {
      console.log(`[Embedding] Query cache hit: "${query.slice(0, 30)}..." (${this.embeddingModel})`);
      return cached;
    }

    // 缓存未命中，调用 API
    console.log(`[Embedding] Query cache miss: "${query.slice(0, 30)}..." (${this.embeddingModel})`);
    const embedding = await withRetry(
      () => withTimeout(
        this.embeddings.embedQuery(query),
        this.timeoutMs,
        'embedQuery'
      ),
      this.maxRetries,
      'embedQuery'
    );

    // 存入缓存
    setQueryEmbeddingToCache(query, this.embeddingModel, embedding);

    return embedding;
  }

  // 批量生成文档 Embedding（带缓存检查，优化为批量查询）
  async embedChunks(chunks: Array<{ content: string; contentHash: string }>): Promise<
    Array<{ contentHash: string; embedding: number[] }>
  > {
    const results: Array<{ contentHash: string; embedding: number[] }> = [];
    const uncachedChunks: Array<{ index: number; content: string; contentHash: string }> = [];

    // 批量查询缓存（优化：一次性查询所有contentHash）
    const contentHashes = chunks.map(c => c.contentHash);
    const cacheMap = await findEmbeddingCacheBatch(contentHashes, this.embeddingModel);

    // 检查每个chunk的缓存
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const cached = cacheMap.get(chunk.contentHash);

      if (cached && cached.length === this.dimensions) {
        results[i] = { contentHash: chunk.contentHash, embedding: cached };
      } else {
        uncachedChunks.push({ index: i, content: chunk.content, contentHash: chunk.contentHash });
      }
    }

    // 批量生成未缓存的 Embedding（带超时和重试）
    if (uncachedChunks.length > 0) {
      const batchContents = uncachedChunks.map(c => c.content);
      const newEmbeddings = await withRetry(
        () => withTimeout(
          this.embeddings.embedDocuments(batchContents),
          this.timeoutMs,
          'embedDocuments'
        ),
        this.maxRetries,
        'embedDocuments'
      );

      for (let j = 0; j < uncachedChunks.length; j++) {
        const { index, contentHash } = uncachedChunks[j];
        const embedding = newEmbeddings[j];

        results[index] = { contentHash, embedding };

        // 存入缓存
        await storeEmbeddingCache(contentHash, embedding, this.embeddingModel);
      }
    }

    return results;
  }

  // 批量处理（分批避免 API 限制）
  async embedChunksBatch(
    chunks: Array<{ content: string; contentHash: string }>,
    batchSize: number = ragConfig.INDEX_BATCH_SIZE
  ): Promise<Array<{ contentHash: string; embedding: number[] }>> {
    const allResults: Array<{ contentHash: string; embedding: number[] }> = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchResults = await this.embedChunks(batch);
      allResults.push(...batchResults);
    }

    return allResults;
  }
}

// 创建 Embedding 生成器（复用 Provider 系统）
export async function createEmbedder(): Promise<KnowledgeEmbedder> {
  // 尝试从配置获取 API Key
  let apiKey = ragConfig.EMBEDDING_API_KEY;
  let baseUrl = ragConfig.EMBEDDING_BASE_URL;
  let embeddingModel: string | undefined;

  // 如果没有单独配置，尝试使用默认 Provider
  if (!apiKey) {
    const { getActiveProviderForCurrentUser } = await import('../../providers/service');
    const provider = await getActiveProviderForCurrentUser();

    if (provider) {
      apiKey = provider.apiKey ?? '';
      baseUrl = provider.baseUrl;
      embeddingModel = provider.embeddingModel;
    }
  }

  if (!apiKey) {
    throw new Error('未配置 Embedding API Key，请在环境变量或 Provider 设置中配置');
  }

  return new KnowledgeEmbedder(apiKey, baseUrl, embeddingModel);
}

// 便捷函数
export async function embedQuery(query: string): Promise<number[]> {
  const embedder = await createEmbedder();
  return embedder.embedQuery(query);
}

export async function embedChunks(
  chunks: Array<{ content: string; contentHash: string }>
): Promise<Array<{ contentHash: string; embedding: number[] }>> {
  const embedder = await createEmbedder();
  return embedder.embedChunksBatch(chunks);
}