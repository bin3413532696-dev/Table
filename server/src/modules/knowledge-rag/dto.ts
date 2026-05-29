import type { KnowledgeDocument, KnowledgeChunk, KnowledgeEmbeddingCache, KnowledgeIndexJob } from '@prisma/client';

// 文档 DTO
export interface DocumentDto {
  id: string;
  userId: string;
  title: string;
  summary: string;
  content: string;
  source: string | null;
  fileType: string | null;
  fileSize: number;
  status: string;
  tags: string[];
  contentHash: string | null;
  version: number;
  // === 结构化元数据 ===
  publishDate: number | null;
  sourceDept: string | null;
  securityLevel: string | null;
  businessCategory: string | null;
  docLanguage: string | null;
  // === 解析质量 ===
  parseQuality: string | null;
  hasOcr: boolean;
  originalMetadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export function toDocumentDto(doc: KnowledgeDocument): DocumentDto {
  return {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    summary: doc.summary ?? '',
    content: doc.content ?? '',
    source: doc.source,
    fileType: doc.fileType,
    fileSize: doc.fileSize ?? 0,
    status: doc.status ?? 'pending',
    tags: toStringArray(doc.tagsJson),
    contentHash: doc.contentHash,
    version: doc.version ?? 1,
    // === 结构化元数据 ===
    publishDate: doc.publishDate?.getTime() ?? null,
    sourceDept: doc.sourceDept,
    securityLevel: doc.securityLevel,
    businessCategory: doc.businessCategory,
    docLanguage: doc.docLanguage,
    // === 解析质量 ===
    parseQuality: doc.parseQuality,
    hasOcr: doc.hasOcr,
    originalMetadata: doc.originalMetadata as Record<string, unknown> | null,
    createdAt: doc.createdAt?.getTime() ?? Date.now(),
    updatedAt: doc.updatedAt?.getTime() ?? Date.now(),
  };
}

// 分块 DTO
export interface ChunkDto {
  id: string;
  documentId: string;
  userId: string;
  content: string;
  contentHash: string;
  chunkIndex: number;
  startPos: number;
  endPos: number;
  headingChain?: string;      // 新增：标题链
  headingLevel?: number;      // 新增：标题层级
  embeddingDimensions?: number; // 新增：embedding 维度
  embeddingVersion?: number;   // 新增：embedding 版本
  chunkType?: string;          // 新增：小块大块类型 ('small' | 'parent')
  parentId?: string;           // 新增：小块关联的大块ID
  hasEmbedding: boolean;
  embeddingModel: string | null;
  createdAt: number;
  updatedAt: number;
}

export function toChunkDto(chunk: KnowledgeChunk): ChunkDto {
  const hasEmbedding = (chunk as any).embedding !== null;

  return {
    id: chunk.id,
    documentId: chunk.documentId,
    userId: chunk.userId,
    content: chunk.content,
    contentHash: chunk.contentHash,
    chunkIndex: chunk.chunkIndex ?? 0,
    startPos: chunk.startPos ?? 0,
    endPos: chunk.endPos ?? 0,
    headingChain: (chunk as any).headingChain ?? undefined,
    headingLevel: (chunk as any).headingLevel ?? undefined,
    embeddingDimensions: (chunk as any).embeddingDimensions ?? undefined,
    embeddingVersion: (chunk as any).embeddingVersion ?? undefined,
    chunkType: (chunk as any).chunkType ?? 'small',
    parentId: (chunk as any).parentId ?? undefined,
    hasEmbedding,
    embeddingModel: chunk.embeddingModel,
    createdAt: chunk.createdAt?.getTime() ?? Date.now(),
    updatedAt: chunk.updatedAt?.getTime() ?? Date.now(),
  };
}

// Embedding 缓存 DTO
export interface EmbeddingCacheDto {
  id: string;
  userId: string;
  contentHash: string;
  embeddingModel: string;
  createdAt: number;
  expiresAt: number | null;
}

export function toEmbeddingCacheDto(cache: KnowledgeEmbeddingCache): EmbeddingCacheDto {
  return {
    id: cache.id,
    userId: cache.userId,
    contentHash: cache.contentHash,
    embeddingModel: cache.embeddingModel,
    createdAt: cache.createdAt?.getTime() ?? Date.now(),
    expiresAt: cache.expiresAt?.getTime() ?? null,
  };
}

// 索引任务 DTO
export interface IndexJobDto {
  id: string;
  userId: string;
  documentId: string | null;
  jobType: string;
  status: string;
  progress: number;
  error: Record<string, unknown> | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

export function toIndexJobDto(job: KnowledgeIndexJob): IndexJobDto {
  return {
    id: job.id,
    userId: job.userId,
    documentId: job.documentId,
    jobType: job.jobType,
    status: job.status ?? 'pending',
    progress: job.progress ?? 0,
    error: job.errorJson as Record<string, unknown> | null,
    startedAt: job.startedAt?.getTime() ?? null,
    completedAt: job.completedAt?.getTime() ?? null,
    createdAt: job.createdAt?.getTime() ?? Date.now(),
  };
}

// 搜索结果 DTO
export interface SearchResultDto {
  id: string;
  documentId: string;
  documentTitle: string;
  headingChain?: string;      // 标题链，用于显示章节路径
  content: string;            // 小块内容（用于展示命中点）
  chunkIndex: number;
  score: number;
  source: 'semantic' | 'keyword' | 'hybrid' | 'reranked';
  sourceInfo: string | null;
  // === 小块大块架构 ===
  parentId?: string;          // 关联的大块ID
  parentContent?: string;     // 大块内容（用于LLM上下文）
  chunkType?: string;         // 'small'
}

// 辅助函数
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

// =====================================================
// 向量格式转换与维度验证
// =====================================================

import { ragConfig } from './config';

/**
 * 验证 embedding 维度是否与配置匹配
 * 用于检测模型切换后维度不一致问题
 */
export function validateEmbeddingDimensions(embedding: number[]): void {
  const configuredDimensions = ragConfig.EMBEDDING_DIMENSIONS;
  const actualDimensions = embedding.length;

  if (actualDimensions !== configuredDimensions) {
    throw new Error(
      `Embedding 维度不匹配: 配置维度=${configuredDimensions}, 实际维度=${actualDimensions}。` +
      `请检查 EMBEDDING_MODEL 和 EMBEDDING_DIMENSIONS 配置是否一致。` +
      `如果切换了模型，可能需要执行向量维度迁移。`
    );
  }
}

/**
 * 格式化向量用于数据库存储
 * 自动验证维度一致性
 */
export function formatVectorForDb(embedding: number[]): string {
  validateEmbeddingDimensions(embedding);
  return `[${embedding.join(',')}]`;
}

/**
 * 解析数据库返回的向量字符串
 * 可选验证维度（用于检测旧数据与新配置不一致）
 */
export function parseVectorFromDb(vectorStr: string, validateDimensions = false): number[] {
  if (!vectorStr || vectorStr.length === 0) return [];
  const cleaned = vectorStr.replace(/^\[|\]$/g, '');
  const embedding = cleaned.split(',').map(Number);

  if (validateDimensions && embedding.length > 0) {
    const configuredDimensions = ragConfig.EMBEDDING_DIMENSIONS;
    if (embedding.length !== configuredDimensions) {
      console.warn(
        `[parseVectorFromDb] 向量维度不一致: 配置=${configuredDimensions}, 实际=${embedding.length}。` +
        `可能是旧数据，请考虑执行向量重建迁移。`
      );
    }
  }

  return embedding;
}

/**
 * 维度迁移辅助信息
 */
export const DIMENSION_MIGRATION_GUIDE = {
  currentDimensions: ragConfig.EMBEDDING_DIMENSIONS,
  supportedDimensions: {
    'text-embedding-3-small': 1536, // 也支持 512, 256
    'text-embedding-3-large': 3072, // 也支持 1536, 1024, 768, 512, 256
    'bge-m3': 1024,
    'bge-small-en-v1.5': 384,
    'bge-base-en-v1.5': 768,
    'bge-large-en-v1.5': 1024,
  },
  migrationSqlTemplate: `
-- 修改向量维度迁移模板
-- 1. 删除旧索引
DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw_idx;

-- 2. 修改列类型
ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector({newDimensions});
ALTER TABLE knowledge_embedding_cache ALTER COLUMN embedding TYPE vector({newDimensions});

-- 3. 创建新索引
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
WHERE embedding IS NOT NULL;

-- 4. 清除旧 embedding 数据（需要重建）
UPDATE knowledge_chunks SET embedding = NULL, embedding_version = NULL;
UPDATE knowledge_documents SET status = 'pending' WHERE status = 'indexed';
`,
};