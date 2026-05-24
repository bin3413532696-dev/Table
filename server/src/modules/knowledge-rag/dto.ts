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
  headingChain?: string;      // 新增：标题链，用于显示章节路径
  content: string;
  chunkIndex: number;
  score: number;
  source: 'semantic' | 'keyword' | 'hybrid' | 'reranked';
  sourceInfo: string | null;
}

// 辅助函数
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

// 向量格式转换
export function formatVectorForDb(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export function parseVectorFromDb(vectorStr: string): number[] {
  if (!vectorStr || vectorStr.length === 0) return [];
  const cleaned = vectorStr.replace(/^\[|\]$/g, '');
  return cleaned.split(',').map(Number);
}