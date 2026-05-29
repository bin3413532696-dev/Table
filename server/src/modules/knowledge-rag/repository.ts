import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import crypto from 'crypto';
import {
  toDocumentDto,
  toChunkDto,
  toIndexJobDto,
  formatVectorForDb,
  parseVectorFromDb,
  SearchResultDto,
} from './dto';
import type {
  CreateDocumentInput,
  UpdateDocumentInput,
  ListDocumentsQuery,
  ListChunksQuery,
  ListJobsQuery,
  HybridSearchInput,
} from './schema';
import { ragConfig } from './config';
import { containsChinese, tokenizeChinese, shouldUseChineseMode } from './utils/chinese-utils';

// 类型定义
export type DocumentRecord = ReturnType<typeof toDocumentDto>;
export type ChunkRecord = ReturnType<typeof toChunkDto>;
export type IndexJobRecord = ReturnType<typeof toIndexJobDto>;

// 分页结果类型
export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// =====================================================
// 文档操作
// =====================================================

export async function listDocuments(query: ListDocumentsQuery): Promise<DocumentRecord[]> {
  const userId = getCurrentUserId();
  const where: Prisma.KnowledgeDocumentWhereInput = { userId };

  if (query.status) {
    where.status = query.status;
  }
  if (query.fileType) {
    where.fileType = query.fileType;
  }
  if (query.tags && query.tags.length > 0) {
    // 多标签查询：文档包含任意一个指定标签即可
    where.OR = query.tags.map(tag => ({
      tagsJson: {
        string_contains: JSON.stringify(tag),
      } as Prisma.JsonFilter,
    }));
  }

  // === 元数据过滤 ===
  if (query.publishDateRange) {
    const { start, end } = query.publishDateRange;
    if (start || end) {
      where.publishDate = {};
      if (start) where.publishDate.gte = new Date(start);
      if (end) where.publishDate.lte = new Date(end);
    }
  }
  if (query.sourceDept && query.sourceDept.length > 0) {
    where.sourceDept = { in: query.sourceDept };
  }
  if (query.securityLevel) {
    where.securityLevel = query.securityLevel;
  }
  if (query.businessCategory && query.businessCategory.length > 0) {
    where.businessCategory = { in: query.businessCategory };
  }

  const docs = await prisma.knowledgeDocument.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: query.limit,
    skip: query.offset,
  });

  return docs.map(toDocumentDto);
}

// 带总数的文档列表（用于分页）
export async function listDocumentsWithCount(query: ListDocumentsQuery): Promise<PaginatedResult<DocumentRecord>> {
  const userId = getCurrentUserId();
  const where: Prisma.KnowledgeDocumentWhereInput = { userId };

  if (query.status) {
    where.status = query.status;
  }
  if (query.fileType) {
    where.fileType = query.fileType;
  }
  if (query.tags && query.tags.length > 0) {
    // 多标签查询：文档包含任意一个指定标签即可
    where.OR = query.tags.map(tag => ({
      tagsJson: {
        string_contains: JSON.stringify(tag),
      } as Prisma.JsonFilter,
    }));
  }

  // === 元数据过滤 ===
  if (query.publishDateRange) {
    const { start, end } = query.publishDateRange;
    if (start || end) {
      where.publishDate = {};
      if (start) where.publishDate.gte = new Date(start);
      if (end) where.publishDate.lte = new Date(end);
    }
  }
  if (query.sourceDept && query.sourceDept.length > 0) {
    where.sourceDept = { in: query.sourceDept };
  }
  if (query.securityLevel) {
    where.securityLevel = query.securityLevel;
  }
  if (query.businessCategory && query.businessCategory.length > 0) {
    where.businessCategory = { in: query.businessCategory };
  }

  const [docs, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  return {
    items: docs.map(toDocumentDto),
    total,
  };
}

export async function findDocumentById(id: string): Promise<DocumentRecord | null> {
  const userId = getCurrentUserId();
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, userId },
  });

  if (!doc) return null;
  return toDocumentDto(doc);
}

export async function createDocument(
  input: CreateDocumentInput,
  fileContent: string,
  fileHash: string,
  fileSize: number,
  metadata?: {
    publishDate?: Date | null;
    sourceDept?: string | null;
    securityLevel?: string | null;
    businessCategory?: string | null;
    docLanguage?: string | null;
    originalMetadata?: Record<string, unknown> | null;
  }
): Promise<DocumentRecord> {
  const userId = getCurrentUserId();
  const now = new Date();

  const doc = await prisma.knowledgeDocument.create({
    data: {
      userId,
      title: input.title.trim(),
      summary: input.summary?.trim() ?? '',
      content: fileContent,
      source: input.source?.trim() ?? null,
      fileType: input.fileType,
      fileSize,
      status: 'pending',
      tagsJson: asJsonValue(input.tags ?? []),
      contentHash: fileHash,
      createdAt: now,
      updatedAt: now,
      // 元数据字段
      ...(metadata?.publishDate ? { publishDate: metadata.publishDate } : {}),
      ...(metadata?.sourceDept ? { sourceDept: metadata.sourceDept } : {}),
      ...(metadata?.securityLevel ? { securityLevel: metadata.securityLevel } : {}),
      ...(metadata?.businessCategory ? { businessCategory: metadata.businessCategory } : {}),
      ...(metadata?.docLanguage ? { docLanguage: metadata.docLanguage } : {}),
      ...(metadata?.originalMetadata ? { originalMetadata: asJsonValue(metadata.originalMetadata) } : {}),
    },
  });

  return toDocumentDto(doc);
}

export async function updateDocument(
  id: string,
  input: UpdateDocumentInput
): Promise<DocumentRecord | null> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { id, userId },
  });

  if (!existing) return null;

  const doc = await prisma.knowledgeDocument.update({
    where: { id, userId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.tags !== undefined ? { tagsJson: asJsonValue(input.tags) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    },
  });

  return toDocumentDto(doc);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { id, userId },
  });

  if (!existing) return false;

  await prisma.knowledgeDocument.delete({
    where: { id, userId },
  });

  return true;
}

export async function updateDocumentStatus(
  id: string,
  status: string,
  summary?: string
): Promise<void> {
  const userId = getCurrentUserId();
  await prisma.knowledgeDocument.update({
    where: { id, userId },
    data: {
      status,
      ...(summary !== undefined ? { summary } : {}),
      updatedAt: new Date(),
    },
  });
}

// =====================================================
// 分块操作
// =====================================================

export async function listChunks(query: ListChunksQuery): Promise<ChunkRecord[]> {
  const userId = getCurrentUserId();
  // embedding 是 Unsupported("vector") 类型，使用 raw SQL 查询避免 Prisma 处理问题
  const chunks = await prisma.$queryRaw<Array<any>>`
    SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
           embedding_model, created_at, updated_at,
           (embedding IS NOT NULL) as has_embedding
    FROM knowledge_chunks
    WHERE document_id = ${query.documentId}::uuid AND user_id = ${userId}::uuid
    ORDER BY chunk_index ASC
    LIMIT ${query.limit}
    OFFSET ${query.offset}
  `;

  return chunks.map((row: any) => ({
    id: row.id,
    documentId: row.document_id,
    userId: row.user_id,
    content: row.content,
    contentHash: row.content_hash,
    chunkIndex: row.chunk_index,
    startPos: row.start_pos,
    endPos: row.end_pos,
    hasEmbedding: row.has_embedding,
    embeddingModel: row.embedding_model,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

// 带总数的分块列表
export async function listChunksWithCount(query: ListChunksQuery): Promise<PaginatedResult<ChunkRecord>> {
  const userId = getCurrentUserId();

  // 使用 raw SQL 查询避免 Unsupported 类型问题
  const [chunks, countResult] = await Promise.all([
    prisma.$queryRaw<Array<any>>`
      SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
             embedding_model, created_at, updated_at,
             (embedding IS NOT NULL) as has_embedding
      FROM knowledge_chunks
      WHERE document_id = ${query.documentId}::uuid AND user_id = ${userId}::uuid
      ORDER BY chunk_index ASC
      LIMIT ${query.limit}
      OFFSET ${query.offset}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM knowledge_chunks
      WHERE document_id = ${query.documentId}::uuid AND user_id = ${userId}::uuid
    `,
  ]);

  return {
    items: chunks.map((row: any) => ({
      id: row.id,
      documentId: row.document_id,
      userId: row.user_id,
      content: row.content,
      contentHash: row.content_hash,
      chunkIndex: row.chunk_index,
      startPos: row.start_pos,
      endPos: row.end_pos,
      hasEmbedding: row.has_embedding,
      embeddingModel: row.embedding_model,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    })),
    total: Number(countResult[0]?.count ?? 0),
  };
}

export async function createChunks(
  documentId: string,
  chunksData: Array<{
    content: string;
    contentHash: string;
    chunkIndex: number;
    startPos: number;
    endPos: number;
    id?: string;
    headingChain?: string;
    headingLevel?: number;
    embeddingDimensions?: number | null;
    embeddingVersion?: number | null;
    chunkType?: string;        // 'small' | 'parent'
    parentId?: string | null;  // 小块关联的大块ID
  }>
): Promise<ChunkRecord[]> {
  const userId = getCurrentUserId();
  const now = new Date();

  if (chunksData.length === 0) return [];

  // 使用单条 multi-row INSERT 提升性能，避免 N 条独立 INSERT 的解析开销
  // Prisma.join 配合参数化查询防止 SQL 注入
  await prisma.$executeRaw`
    INSERT INTO knowledge_chunks (
      id, document_id, user_id, content, content_hash,
      chunk_index, start_pos, end_pos,
      heading_chain, heading_level,
      embedding_dimensions, embedding_version,
      chunk_type, parent_id,
      created_at, updated_at
    )
    VALUES ${Prisma.join(chunksData.map((chunk) => Prisma.sql`(
      ${chunk.id ?? crypto.randomUUID()}::uuid,
      ${documentId}::uuid,
      ${userId}::uuid,
      ${chunk.content},
      ${chunk.contentHash},
      ${chunk.chunkIndex},
      ${chunk.startPos},
      ${chunk.endPos},
      ${chunk.headingChain ?? null},
      ${chunk.headingLevel ?? null},
      ${chunk.embeddingDimensions ?? null},
      ${chunk.embeddingVersion ?? null},
      ${chunk.chunkType ?? 'small'},
      ${chunk.parentId ?? null}::uuid,
      ${now},
      ${now}
    )`), ',', '')}
  `;

  // 查询刚创建的记录（按 chunkIndex 排序）
  const chunks = await prisma.$queryRaw<Array<any>>`
    SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
           heading_chain, heading_level,
           embedding_model, embedding_dimensions, embedding_version,
           chunk_type, parent_id,
           created_at, updated_at,
           (embedding IS NOT NULL) as has_embedding
    FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid
    ORDER BY chunk_index ASC
  `;

  return chunks.map((row: any) => ({
    id: row.id,
    documentId: row.document_id,
    userId: row.user_id,
    content: row.content,
    contentHash: row.content_hash,
    chunkIndex: row.chunk_index,
    startPos: row.start_pos,
    endPos: row.end_pos,
    headingChain: row.heading_chain,
    headingLevel: row.heading_level,
    hasEmbedding: row.has_embedding,
    embeddingModel: row.embedding_model,
    embeddingDimensions: row.embedding_dimensions,
    embeddingVersion: row.embedding_version,
    chunkType: row.chunk_type,
    parentId: row.parent_id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

// P4 增量索引：获取文档现有的 chunk hashes
// chunkType 参数：可选，用于只获取特定类型的 chunk hash
export async function getChunkHashes(documentId: string, chunkType?: string): Promise<string[]> {
  const userId = getCurrentUserId();
  if (chunkType) {
    const chunks = await prisma.$queryRaw<Array<{ content_hash: string }>>`
      SELECT content_hash FROM knowledge_chunks
      WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid AND chunk_type = ${chunkType}
    `;
    return chunks.map(c => c.content_hash);
  }
  const chunks = await prisma.$queryRaw<Array<{ content_hash: string }>>`
    SELECT content_hash FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid
  `;
  return chunks.map(c => c.content_hash);
}

// P4 增量索引：获取指定 hashes 的 chunk ID 映射
export async function getChunkIdsByHash(documentId: string, hashes: string[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const userId = getCurrentUserId();
  const chunks = await prisma.$queryRaw<Array<{ id: string; content_hash: string }>>`
    SELECT id::text, content_hash FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid AND content_hash = ANY(${hashes})
  `;
  return new Map(chunks.map(c => [c.content_hash, c.id]));
}

// P4 增量索引：删除指定 hashes 的 chunks
export async function deleteChunksByHash(documentId: string, hashes: string[]): Promise<number> {
  if (hashes.length === 0) return 0;
  const userId = getCurrentUserId();
  const result = await prisma.$executeRaw`
    DELETE FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid
      AND content_hash IN (${Prisma.join(hashes)})
  `;
  return result;
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  const userId = getCurrentUserId();
  await prisma.knowledgeChunk.deleteMany({
    where: { documentId, userId },
  });
}

// =====================================================
// 分层存储：小块大块架构支持
// =====================================================

// 根据小块的 parentId 列表查询大块内容（用于检索上下文扩展）
export async function findParentChunksByIds(
  userId: string,
  parentIds: string[]
): Promise<Array<{
  id: string;
  documentId: string;
  content: string;
  headingChain: string | null;
}>> {
  if (parentIds.length === 0) return [];

  // 使用 IN 查询批量获取大块
  const chunks = await prisma.$queryRaw<Array<any>>`
    SELECT id::text, document_id::text, content, heading_chain
    FROM knowledge_chunks
    WHERE user_id = ${userId}::uuid
      AND id = ANY(${parentIds}::uuid[])
      AND chunk_type = 'parent'
  `;

  return chunks.map((row: any) => ({
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    headingChain: row.heading_chain,
  }));
}

export async function updateChunkEmbedding(
  chunkId: string,
  embedding: number[],
  embeddingModel: string
): Promise<void> {
  const userId = getCurrentUserId();
  const embeddingStr = formatVectorForDb(embedding);

  await prisma.$executeRaw`
    UPDATE knowledge_chunks
    SET embedding = ${embeddingStr}::vector, embedding_model = ${embeddingModel}, updated_at = now()
    WHERE id = ${chunkId}::uuid AND user_id = ${userId}::uuid
  `;
}

// 批量更新 Embedding（性能优化：使用临时表 + 单次 UPDATE）
export async function updateChunkEmbeddingsBatch(
  updates: Array<{ chunkId: string; embedding: number[]; embeddingModel: string }>
): Promise<void> {
  if (updates.length === 0) return;

  const userId = getCurrentUserId();
  const embeddingModel = updates[0].embeddingModel; // 同批次使用相同模型

  // 创建临时表存储更新数据，单次 JOIN UPDATE 提升性能
  // 避免 N 条独立 UPDATE 的解析开销
  await prisma.$executeRaw`
    WITH updates_temp(id, embedding_vec) AS (
      VALUES ${Prisma.join(updates.map(({ chunkId, embedding }) => {
        const embeddingStr = formatVectorForDb(embedding);
        return Prisma.sql`(${chunkId}::uuid, ${embeddingStr}::vector)`;
      }), ',', '')}
    )
    UPDATE knowledge_chunks c
    SET embedding = u.embedding_vec,
        embedding_model = ${embeddingModel},
        updated_at = now()
    FROM updates_temp u
    WHERE c.id = u.id AND c.user_id = ${userId}::uuid
  `;
}

export async function getChunksWithoutEmbedding(documentId: string): Promise<ChunkRecord[]> {
  const userId = getCurrentUserId();
  // embedding 是 Unsupported("vector") 类型，无法用 Prisma where 过滤，使用 raw SQL
  const chunks = await prisma.$queryRaw<Array<any>>`
    SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
           embedding_model, created_at, updated_at
    FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid AND embedding IS NULL
    ORDER BY chunk_index ASC
  `;

  return chunks.map((row: any) => ({
    id: row.id,
    documentId: row.document_id,
    userId: row.user_id,
    content: row.content,
    contentHash: row.content_hash,
    chunkIndex: row.chunk_index,
    startPos: row.start_pos,
    endPos: row.end_pos,
    hasEmbedding: false,
    embeddingModel: row.embedding_model,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

// =====================================================
// Embedding 缓存操作
// =====================================================

export async function findEmbeddingCache(
  contentHash: string,
  embeddingModel: string
): Promise<number[] | null> {
  const userId = getCurrentUserId();

  // embedding 是 Unsupported("vector") 类型，使用 raw SQL 查询
  const result = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT embedding::text as embedding
    FROM knowledge_embedding_cache
    WHERE user_id = ${userId}::uuid
      AND content_hash = ${contentHash}
      AND embedding_model = ${embeddingModel}
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `;

  if (result.length === 0) return null;
  return parseVectorFromDb(result[0].embedding);
}

// 批量查询 Embedding 缓存（优化性能）
export async function findEmbeddingCacheBatch(
  contentHashes: string[],
  embeddingModel: string
): Promise<Map<string, number[]>> {
  const userId = getCurrentUserId();
  const cacheMap = new Map<string, number[]>();

  if (contentHashes.length === 0) return cacheMap;

  // embedding 是 Unsupported("vector") 类型，使用 raw SQL 查询
  const cachedRecords = await prisma.$queryRaw<Array<{ content_hash: string; embedding: string }>>`
    SELECT content_hash, embedding::text as embedding
    FROM knowledge_embedding_cache
    WHERE user_id = ${userId}::uuid
      AND content_hash = ANY(${contentHashes})
      AND embedding_model = ${embeddingModel}
      AND (expires_at IS NULL OR expires_at > now())
  `;

  for (const record of cachedRecords) {
    const embedding = parseVectorFromDb(record.embedding);
    if (embedding && embedding.length > 0) {
      cacheMap.set(record.content_hash, embedding);
    }
  }

  return cacheMap;
}

export async function storeEmbeddingCache(
  contentHash: string,
  embedding: number[],
  embeddingModel: string
): Promise<void> {
  const userId = getCurrentUserId();
  const embeddingStr = formatVectorForDb(embedding);
  const expiresAt = new Date(Date.now() + ragConfig.CACHE_EMBEDDING_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$executeRaw`
    INSERT INTO knowledge_embedding_cache (id, user_id, content_hash, embedding, embedding_model, created_at, expires_at)
    VALUES (gen_random_uuid(), ${userId}::uuid, ${contentHash}, ${embeddingStr}::vector, ${embeddingModel}, now(), ${expiresAt})
    ON CONFLICT (user_id, content_hash, embedding_model) DO UPDATE
    SET embedding = ${embeddingStr}::vector, expires_at = ${expiresAt}
  `;
}

// =====================================================
// 索引任务操作
// =====================================================

export async function listJobs(query: ListJobsQuery): Promise<IndexJobRecord[]> {
  const userId = getCurrentUserId();
  const where: Prisma.KnowledgeIndexJobWhereInput = { userId };

  if (query.status) {
    where.status = query.status;
  }
  if (query.documentId) {
    where.documentId = query.documentId;
  }

  const jobs = await prisma.knowledgeIndexJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    skip: query.offset,
  });

  return jobs.map(toIndexJobDto);
}

// 带总数的任务列表
export async function listJobsWithCount(query: ListJobsQuery): Promise<PaginatedResult<IndexJobRecord>> {
  const userId = getCurrentUserId();
  const where: Prisma.KnowledgeIndexJobWhereInput = { userId };

  if (query.status) {
    where.status = query.status;
  }
  if (query.documentId) {
    where.documentId = query.documentId;
  }

  const [jobs, total] = await Promise.all([
    prisma.knowledgeIndexJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.knowledgeIndexJob.count({ where }),
  ]);

  return {
    items: jobs.map(toIndexJobDto),
    total,
  };
}

export async function findJobById(id: string): Promise<IndexJobRecord | null> {
  const userId = getCurrentUserId();
  const job = await prisma.knowledgeIndexJob.findFirst({
    where: { id, userId },
  });

  if (!job) return null;
  return toIndexJobDto(job);
}

// 获取待处理任务（用于后台队列轮询）
export async function findPendingJobs(limit: number = 10): Promise<IndexJobRecord[]> {
  // 不限 userId，因为队列处理器需要获取所有用户的待处理任务
  // 实际处理时会根据 document 的 userId 进行权限检查
  const jobs = await prisma.knowledgeIndexJob.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' }, // FIFO：先入先出
    take: limit,
  });

  return jobs.map(toIndexJobDto);
}

export async function createJob(
  documentId: string | null,
  jobType: string
): Promise<IndexJobRecord> {
  const userId = getCurrentUserId();

  const job = await prisma.knowledgeIndexJob.create({
    data: {
      userId,
      documentId,
      jobType,
      status: 'pending',
      createdAt: new Date(),
    },
  });

  return toIndexJobDto(job);
}

export async function updateJobStatus(
  id: string,
  status: string,
  progress?: number,
  error?: Record<string, unknown>
): Promise<void> {
  const userId = getCurrentUserId();
  const updateData: Prisma.KnowledgeIndexJobUpdateInput = {
    status,
    ...(progress !== undefined ? { progress } : {}),
    ...(error !== undefined ? { errorJson: asJsonValue(error) } : {}),
  };

  if (status === 'running') {
    updateData.startedAt = new Date();
  } else if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date();
  }

  await prisma.knowledgeIndexJob.updateMany({
    where: { id, userId },
    data: updateData,
  });
}

// 查询超时的 Job（用于恢复机制）
export async function findStaleJobs(timeoutMinutes: number = 30): Promise<IndexJobRecord[]> {
  const timeoutDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const staleJobs = await prisma.knowledgeIndexJob.findMany({
    where: {
      status: 'running',
      startedAt: { lt: timeoutDate },
    },
    orderBy: { id: 'asc' }, // 使用 id 排序（UUID 按时间顺序生成）
  });

  return staleJobs.map(toIndexJobDto);
}

// 重置超时的 Job 为 failed 状态
export async function resetStaleJobs(timeoutMinutes: number = 30): Promise<number> {
  const timeoutDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const result = await prisma.knowledgeIndexJob.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: timeoutDate },
    },
    data: {
      status: 'failed',
      errorJson: asJsonValue({ message: 'Job timeout - process may have crashed' }),
      completedAt: new Date(),
    },
  });

  return result.count;
}

// =====================================================
// 搜索操作（混合搜索）
// =====================================================

interface SearchResultRow {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  heading_chain: string | null;    // 新增
  heading_level: number | null;    // 新增
  document_title: string;
  source: string | null;
  score: number;
}

// 距离度量运算符映射
type DistanceMetric = 'cosine' | 'euclidean' | 'inner_product';
function getDistanceOperator(metric: DistanceMetric): string {
  const operators: Record<DistanceMetric, string> = {
    cosine: '<=>',        // 余弦距离
    euclidean: '<->',     // 欧氏距离（L2）
    inner_product: '<#>', // 内积（负值，用于排序）
  };
  return operators[metric] || '<=>';
}

// 根据距离度量计算相似度分数
// cosine: 1 - distance (范围 0-1)
// euclidean: 需归一化，返回负距离（距离越小相似度越高）
// inner_product: 直接返回内积（越大相似度越高，需确保向量归一化）
function calculateSimilarityScore(metric: DistanceMetric, distanceValue: number): number {
  switch (metric) {
    case 'cosine':
      return 1 - distanceValue; // 余弦距离转相似度
    case 'euclidean':
      // L2 距离无固定范围，返回负值用于排序
      // 实际分数计算在 SQL 中使用 -distance
      return -distanceValue;
    case 'inner_product':
      // 内积直接作为相似度（归一化向量时范围 -1 到 1，非归一化时范围不定）
      return distanceValue;
    default:
      return 1 - distanceValue;
  }
}

export async function semanticSearch(
  queryEmbedding: number[],
  params: HybridSearchInput
): Promise<SearchResultDto[]> {
  const userId = getCurrentUserId();
  const embeddingStr = formatVectorForDb(queryEmbedding);
  const currentVersion = ragConfig.EMBEDDING_VERSION ?? 1;
  const distanceMetric = (ragConfig.EMBEDDING_DISTANCE_METRIC || 'cosine') as DistanceMetric;
  const distanceOp = getDistanceOperator(distanceMetric);

  // 标签过滤：使用 @> 包含查询 + GIN 索引优化
  const tagFilter = params.tags && params.tags.length > 0
    ? params.tags.length === 1
      ? Prisma.sql`AND d.tags_json @> ${Prisma.sql`'["${params.tags[0]}"]'::jsonb`}`
      : Prisma.sql`AND (${Prisma.join(params.tags.map(tag =>
          Prisma.sql`d.tags_json @> ${Prisma.sql`'["${tag}"]'::jsonb`}`
        ), ' OR ')})`
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

  // 元数据过滤
  const metadataFilter = buildMetadataFilterSQL(params);

  // 构建动态 SQL 以支持不同距离度量
  const scoreExpression = distanceMetric === 'cosine'
    ? Prisma.sql`1 - (c.embedding ${Prisma.raw(distanceOp)} ${embeddingStr}::vector)`
    : distanceMetric === 'inner_product'
      ? Prisma.sql`(c.embedding ${Prisma.raw(distanceOp)} ${embeddingStr}::vector)`
      : Prisma.sql`-(c.embedding ${Prisma.raw(distanceOp)} ${embeddingStr}::vector)`;

  const orderDirection = distanceMetric === 'inner_product' ? 'DESC' : 'ASC';

  // === 小块大块架构：只检索小块 ===
  const results = await prisma.$queryRaw<SearchResultRow[]>`
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.chunk_index,
      c.heading_chain,
      c.heading_level,
      c.parent_id,
      d.title as document_title,
      d.source,
      d.publish_date,
      d.source_dept,
      d.security_level,
      d.business_category,
      ${scoreExpression} as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND c.embedding IS NOT NULL
      AND c.embedding_version = ${currentVersion}
      AND c.chunk_type = 'small'
      AND d.status = 'indexed'
      ${tagFilter}
      ${docFilter}
      ${metadataFilter}
    ORDER BY c.embedding ${Prisma.raw(distanceOp)} ${embeddingStr}::vector ${Prisma.raw(orderDirection)}
    LIMIT ${params.limit * 2}
  `;

  return results.map((r: any) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'semantic',
    sourceInfo: r.source,
    parentId: r.parent_id ?? undefined,
    publishDate: r.publish_date ? new Date(r.publish_date).getTime() : null,
    sourceDept: r.source_dept,
    securityLevel: r.security_level,
    businessCategory: r.business_category,
  }));
}

// 构建元数据过滤 SQL 条件
function buildMetadataFilterSQL(params: HybridSearchInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  // 发布日期范围
  if (params.publishDateRange) {
    if (params.publishDateRange.start) {
      conditions.push(Prisma.sql`d.publish_date >= ${new Date(params.publishDateRange.start)}::date`);
    }
    if (params.publishDateRange.end) {
      conditions.push(Prisma.sql`d.publish_date <= ${new Date(params.publishDateRange.end)}::date`);
    }
  }

  // 来源部门
  if (params.sourceDept && params.sourceDept.length > 0) {
    conditions.push(Prisma.sql`d.source_dept = ANY(${params.sourceDept}::text[])`);
  }

  // 保密等级
  if (params.securityLevel) {
    conditions.push(Prisma.sql`d.security_level = ${params.securityLevel}`);
  }

  // 业务分类
  if (params.businessCategory && params.businessCategory.length > 0) {
    conditions.push(Prisma.sql`d.business_category = ANY(${params.businessCategory}::text[])`);
  }

  return conditions.length > 0
    ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
}

// 使用 pg_trgm 模糊匹配替代 tsquery
// 将查询分词（支持中英文混合）
function buildTrgmSearchPattern(query: string): string {
  const queryTerms = query.split(/\s+/).filter(Boolean);
  // 单词用 & 连接，整体用 ILIKE 模式匹配
  return queryTerms.length > 0 ? `%${queryTerms.join('%')}%` : `%${query}%`;
}

export async function keywordSearch(
  query: string,
  params: HybridSearchInput
): Promise<SearchResultDto[]> {
  const userId = getCurrentUserId();

  // 标签过滤：使用 @> 包含查询 + GIN 索引优化
  // 替代 jsonb_array_elements_text 展开，利用 jsonb_path_ops 索引
  const tagFilter = params.tags && params.tags.length > 0
    ? params.tags.length === 1
      // 单标签：d.tags_json @> '["tag"]'::jsonb（命中 jsonb_path_ops 索引）
      ? Prisma.sql`AND d.tags_json @> ${Prisma.sql`'["${params.tags[0]}"]'::jsonb`}`
      // 多标签：OR 组合多个 @> 条件（每个条件命中索引）
      : Prisma.sql`AND (${Prisma.join(params.tags.map(tag =>
          Prisma.sql`d.tags_json @> ${Prisma.sql`'["${tag}"]'::jsonb`}`
        ), ' OR ')})`
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

  // 元数据过滤
  const metadataFilter = buildMetadataFilterSQL(params);

  // === 小块大块架构：只检索小块 ===
  // 中文查询：使用 ILIKE ANY 匹配分词后的字符
  if (shouldUseChineseMode(query)) {
    const tokens = tokenizeChinese(query);
    if (tokens.length === 0) return [];

    // 构建 ILIKE 模式数组
    const patterns = tokens.map(t => `%${t}%`);

    // 使用 ILIKE ANY 进行匹配，分数基于匹配词数占比
    const results = await prisma.$queryRaw<SearchResultRow[]>`
      SELECT
        c.id,
        c.document_id,
        c.content,
        c.chunk_index,
        c.heading_chain,
        c.heading_level,
        c.parent_id,
        d.title as document_title,
        d.source,
        d.publish_date,
        d.source_dept,
        d.security_level,
        d.business_category,
        (
          SELECT COUNT(*)::float FROM unnest(${patterns}::text[]) p
          WHERE c.content ILIKE p
        ) / ${tokens.length} as score
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.user_id = ${userId}::uuid
        AND c.chunk_type = 'small'
        AND d.status = 'indexed'
        AND c.content ILIKE ANY (${patterns}::text[])
        ${tagFilter}
        ${docFilter}
        ${metadataFilter}
      ORDER BY score DESC
      LIMIT ${params.limit * 2}
    `;

    return results.map((r: any) => ({
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      headingChain: r.heading_chain ?? undefined,
      content: r.content,
      chunkIndex: r.chunk_index,
      score: Number(r.score),
      source: 'keyword',
      sourceInfo: r.source,
      parentId: r.parent_id ?? undefined,
      publishDate: r.publish_date ? new Date(r.publish_date).getTime() : null,
      sourceDept: r.source_dept,
      securityLevel: r.security_level,
      businessCategory: r.business_category,
    }));
  }

  // 非中文查询：保留 pg_trgm similarity 逻辑
  const results = await prisma.$queryRaw<SearchResultRow[]>`
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.chunk_index,
      c.heading_chain,
      c.heading_level,
      c.parent_id,
      d.title as document_title,
      d.source,
      d.publish_date,
      d.source_dept,
      d.security_level,
      d.business_category,
      similarity(c.content, ${query}) as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND c.chunk_type = 'small'
      AND d.status = 'indexed'
      AND c.content % ${query}
      ${tagFilter}
      ${docFilter}
      ${metadataFilter}
    ORDER BY score DESC
    LIMIT ${params.limit * 2}
  `;

  return results.map((r: any) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'keyword',
    sourceInfo: r.source,
    parentId: r.parent_id ?? undefined,
    publishDate: r.publish_date ? new Date(r.publish_date).getTime() : null,
    sourceDept: r.source_dept,
    securityLevel: r.security_level,
    businessCategory: r.business_category,
  }));
}

// =====================================================
// BM25 全文检索（tsvector + tsquery）+ 分数归一化
// =====================================================

/**
 * BM25 分数归一化
 * ts_rank_cd 返回无固定范围的分数，使用 Sigmoid 函数归一化到 0-1
 * 公式: score_normalized = 1 / (1 + exp(-k * (score_raw - offset)))
 * 参数选择：k=0.3, offset=1.0 使典型分数范围 (0-10) 映射到合理区间
 */
const BM25_NORMALIZATION_K = 0.3;
const BM25_NORMALIZATION_OFFSET = 1.0;

export async function bm25Search(
  query: string,
  params: HybridSearchInput
): Promise<SearchResultDto[]> {
  const userId = getCurrentUserId();

  // 标签过滤：使用 @> 包含查询 + GIN 索引优化
  const tagFilter = params.tags && params.tags.length > 0
    ? params.tags.length === 1
      ? Prisma.sql`AND d.tags_json @> ${Prisma.sql`'["${params.tags[0]}"]'::jsonb`}`
      : Prisma.sql`AND (${Prisma.join(params.tags.map(tag =>
          Prisma.sql`d.tags_json @> ${Prisma.sql`'["${tag}"]'::jsonb`}`
        ), ' OR ')})`
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

  // 元数据过滤
  const metadataFilter = buildMetadataFilterSQL(params);

  const queryTerms = query.split(/[，。；：！？\s+]/).filter(t => t.length > 0);
  if (queryTerms.length === 0) return [];

  const tsqueryStr = queryTerms.join(' | ');

  // 使用 Sigmoid 归一化 BM25 分数
  const results = await prisma.$queryRaw<SearchResultRow[]>`
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.chunk_index,
      c.heading_chain,
      c.heading_level,
      d.title as document_title,
      d.source,
      d.publish_date,
      d.source_dept,
      d.security_level,
      d.business_category,
      1.0 / (1.0 + exp(-${BM25_NORMALIZATION_K} * (
        ts_rank_cd(c.content_tsvector, to_tsquery('simple', ${tsqueryStr}), 32)
        - ${BM25_NORMALIZATION_OFFSET}
      ))) as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND d.status = 'indexed'
      AND c.content_tsvector IS NOT NULL
      AND c.content_tsvector @@ to_tsquery('simple', ${tsqueryStr})
      ${tagFilter}
      ${docFilter}
      ${metadataFilter}
    ORDER BY score DESC
    LIMIT ${params.limit * 2}
  `;

  return results.map((r: any) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'keyword' as const,
    sourceInfo: r.source,
    publishDate: r.publish_date ? new Date(r.publish_date).getTime() : null,
    sourceDept: r.source_dept,
    securityLevel: r.security_level,
    businessCategory: r.business_category,
  }));
}

// =====================================================
// Embedding 批量获取（用于 MMR 多样性计算）
// =====================================================

export async function getChunkEmbeddingsBatch(chunkIds: string[]): Promise<Map<string, number[]>> {
  const userId = getCurrentUserId();
  const currentVersion = ragConfig.EMBEDDING_VERSION ?? 1;

  if (chunkIds.length === 0) return new Map<string, number[]>();

  const results = await prisma.$queryRaw<Array<{ id: string; embedding: string }>>`
    SELECT id, embedding::text as embedding
    FROM knowledge_chunks
    WHERE id = ANY(${chunkIds}::uuid[])
      AND user_id = ${userId}::uuid
      AND embedding IS NOT NULL
      AND embedding_version = ${currentVersion}
  `;

  const embeddingMap = new Map<string, number[]>();
  for (const row of results) {
    const embedding = parseVectorFromDb(row.embedding);
    if (embedding && embedding.length > 0) {
      embeddingMap.set(row.id, embedding);
    }
  }

  return embeddingMap;
}

// =====================================================
// 单个 Chunk 读取（用于 Agent chunk_read 工具）
// =====================================================

export async function getChunkById(chunkId: string): Promise<{
  id: string;
  documentId: string;
  documentTitle: string;
  headingChain: string | null;
  content: string;
  chunkIndex: number;
} | null> {
  const userId = getCurrentUserId();

  const results = await prisma.$queryRaw<Array<{
    id: string;
    document_id: string;
    content: string;
    chunk_index: number;
    heading_chain: string | null;
    document_title: string;
  }>>`
    SELECT c.id, c.document_id, c.content, c.chunk_index, c.heading_chain,
           d.title as document_title
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.id = ${chunkId}::uuid AND c.user_id = ${userId}::uuid AND d.status = 'indexed'
    LIMIT 1
  `;

  if (results.length === 0) return null;

  const row = results[0];
  return {
    id: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    headingChain: row.heading_chain,
    content: row.content,
    chunkIndex: row.chunk_index,
  };
}

// =====================================================
// 统计操作
// =====================================================

export async function getRagStats(): Promise<{
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
  chunkWithEmbeddingCount: number;
  cacheCount: number;
}> {
  const userId = getCurrentUserId();

  const documentCount = await prisma.knowledgeDocument.count({ where: { userId } });
  const indexedDocumentCount = await prisma.knowledgeDocument.count({
    where: { userId, status: 'indexed' },
  });
  const chunkCount = await prisma.knowledgeChunk.count({ where: { userId } });

  const chunkWithEmbeddingResult = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM knowledge_chunks
    WHERE user_id = ${userId}::uuid AND embedding IS NOT NULL
  `;
  const chunkWithEmbeddingCount = Number(chunkWithEmbeddingResult[0]?.count ?? 0);

  const cacheCount = await prisma.knowledgeEmbeddingCache.count({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  return {
    documentCount,
    indexedDocumentCount,
    chunkCount,
    chunkWithEmbeddingCount,
    cacheCount,
  };
}