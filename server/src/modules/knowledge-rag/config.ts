import { z } from 'zod';

/**
 * 环境变量布尔值解析
 * 正确处理 'true'/'false' 字符串（Zod coerce.boolean() 会把 'false' 变成 true）
 */
const envBoolean = z.preprocess((val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return Boolean(val);
}, z.boolean());

const ragConfigSchema = z.object({
  // Embedding 配置
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  EMBEDDING_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  EMBEDDING_VERSION: z.coerce.number().int().positive().default(1),
  // 距离度量配置：cosine（余弦）、euclidean（欧氏/L2）、inner_product（内积）
  EMBEDDING_DISTANCE_METRIC: z.enum(['cosine', 'euclidean', 'inner_product']).default('cosine'),
  // 注：CHUNK_SIZE/CHUNK_OVERLAP 已移除，分块参数在 chunker.ts CHUNK_STRATEGIES 中按文件类型配置

  // 搜索配置
  SEARCH_FUSION_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  SEARCH_DEFAULT_LIMIT: z.coerce.number().int().positive().default(20),
  SEARCH_MIN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  SEARCH_RRF_K: z.coerce.number().int().positive().default(60),

  // 索引配置
  INDEX_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  INDEX_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(50),
  INDEX_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),

  // 缓存配置
  CACHE_EMBEDDING_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CACHE_QUERY_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Cross-Encoder Reranker 配置（新增）
  RERANKER_ENABLED: envBoolean.default(false),
  RERANKER_TOP_N: z.coerce.number().int().positive().default(20),
  RERANKER_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  RERANKER_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),
  RERANKER_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  RERANKER_CANDIDATE_MIN: z.coerce.number().int().positive().default(50),
  RERANKER_CANDIDATE_MAX: z.coerce.number().int().positive().default(100),

  // MMR 多样性后处理配置（新增）
  MMR_ENABLED: envBoolean.default(false),
  MMR_LAMBDA: z.coerce.number().min(0).max(1).default(0.7),

  // BM25 全文检索配置（新增）
  BM25_ENABLED: envBoolean.default(false),

  // Query 预处理配置（新增）
  QUERY_PREPROCESSOR_ENABLED: envBoolean.default(false),
  QUERY_EXPANSION_COUNT: z.coerce.number().int().min(2).max(5).default(3),
  QUERY_REWRITE_ENABLED: envBoolean.default(true),
  QUERY_PREPROCESSOR_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  // Agent 默认功能配置（新增）
  RERANKER_ENABLED_BY_DEFAULT: envBoolean.default(true),
  MMR_ENABLED_BY_DEFAULT: envBoolean.default(false),
  QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT: envBoolean.default(false),

  // Citation 配置（新增）
  CITATION_MIN_CHUNKS: z.coerce.number().int().min(0).default(1),
  CITATION_MAX_CHUNKS: z.coerce.number().int().min(1).max(20).default(10),
  CITATION_REQUIRED_FOR_FACTS: envBoolean.default(true),
  CITATION_LOW_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),

  // OCR 服务配置
  OCR_SERVICE_URL: z.string().default('http://localhost:8001'),
  OCR_ENABLED: envBoolean.default(true),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
});

type RagConfig = z.infer<typeof ragConfigSchema>;

function loadRagConfig(): RagConfig {
  const env = {
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
    EMBEDDING_TIMEOUT_MS: process.env.EMBEDDING_TIMEOUT_MS,
    EMBEDDING_MAX_RETRIES: process.env.EMBEDDING_MAX_RETRIES,
    EMBEDDING_VERSION: process.env.EMBEDDING_VERSION,
    EMBEDDING_DISTANCE_METRIC: process.env.EMBEDDING_DISTANCE_METRIC,
    CHUNK_SIZE: process.env.CHUNK_SIZE,
    CHUNK_OVERLAP: process.env.CHUNK_OVERLAP,
    SEARCH_FUSION_WEIGHT: process.env.SEARCH_FUSION_WEIGHT,
    SEARCH_DEFAULT_LIMIT: process.env.SEARCH_DEFAULT_LIMIT,
    SEARCH_MIN_THRESHOLD: process.env.SEARCH_MIN_THRESHOLD,
    SEARCH_RRF_K: process.env.SEARCH_RRF_K,
    INDEX_BATCH_SIZE: process.env.INDEX_BATCH_SIZE,
    INDEX_MAX_FILE_SIZE_MB: process.env.INDEX_MAX_FILE_SIZE_MB,
    INDEX_TIMEOUT_MS: process.env.INDEX_TIMEOUT_MS,
    CACHE_EMBEDDING_TTL_DAYS: process.env.CACHE_EMBEDDING_TTL_DAYS,
    CACHE_QUERY_TTL_SECONDS: process.env.CACHE_QUERY_TTL_SECONDS,
    RERANKER_ENABLED: process.env.RERANKER_ENABLED,
    RERANKER_TOP_N: process.env.RERANKER_TOP_N,
    RERANKER_TIMEOUT_MS: process.env.RERANKER_TIMEOUT_MS,
    RERANKER_MIN_SCORE: process.env.RERANKER_MIN_SCORE,
    RERANKER_MAX_TOKENS: process.env.RERANKER_MAX_TOKENS,
    RERANKER_CANDIDATE_MIN: process.env.RERANKER_CANDIDATE_MIN,
    RERANKER_CANDIDATE_MAX: process.env.RERANKER_CANDIDATE_MAX,
    MMR_ENABLED: process.env.MMR_ENABLED,
    MMR_LAMBDA: process.env.MMR_LAMBDA,
    BM25_ENABLED: process.env.BM25_ENABLED,
    QUERY_PREPROCESSOR_ENABLED: process.env.QUERY_PREPROCESSOR_ENABLED,
    QUERY_EXPANSION_COUNT: process.env.QUERY_EXPANSION_COUNT,
    QUERY_REWRITE_ENABLED: process.env.QUERY_REWRITE_ENABLED,
    QUERY_PREPROCESSOR_TIMEOUT_MS: process.env.QUERY_PREPROCESSOR_TIMEOUT_MS,
    RERANKER_ENABLED_BY_DEFAULT: process.env.RERANKER_ENABLED_BY_DEFAULT,
    MMR_ENABLED_BY_DEFAULT: process.env.MMR_ENABLED_BY_DEFAULT,
    QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT: process.env.QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT,
    CITATION_MIN_CHUNKS: process.env.CITATION_MIN_CHUNKS,
    CITATION_MAX_CHUNKS: process.env.CITATION_MAX_CHUNKS,
    CITATION_REQUIRED_FOR_FACTS: process.env.CITATION_REQUIRED_FOR_FACTS,
    CITATION_LOW_SCORE_THRESHOLD: process.env.CITATION_LOW_SCORE_THRESHOLD,
    OCR_SERVICE_URL: process.env.OCR_SERVICE_URL,
    OCR_ENABLED: process.env.OCR_ENABLED,
    OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS,
  };

  return ragConfigSchema.parse(env);
}

export const ragConfig = loadRagConfig();

export { ragConfigSchema };

export type {
  RagConfig,
};