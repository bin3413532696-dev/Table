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
  fileSize: number
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
    headingChain?: string;    // 新增
    headingLevel?: number;    // 新增
    embeddingDimensions?: number;  // 新增
    embeddingVersion?: number;     // 新增
  }>
): Promise<ChunkRecord[]> {
  const userId = getCurrentUserId();
  const now = new Date();

  // 使用 $executeRaw 插入，避免 Prisma 无法处理 vector 类型的问题
  await prisma.$transaction(
    chunksData.map((chunk) =>
      prisma.$executeRaw`
        INSERT INTO knowledge_chunks (
          id, document_id, user_id, content, content_hash,
          chunk_index, start_pos, end_pos,
          heading_chain, heading_level,
          embedding_dimensions, embedding_version,
          created_at, updated_at
        )
        VALUES (
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
          ${chunk.embeddingVersion ?? 1},
          ${now},
          ${now}
        )
      `
    )
  );

  // 查询刚创建的记录（按 chunkIndex 排序）
  const chunks = await prisma.$queryRaw<Array<any>>`
    SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
           heading_chain, heading_level,
           embedding_model, embedding_dimensions, embedding_version,
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
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

// P4 增量索引：获取文档现有的 chunk hashes
export async function getChunkHashes(documentId: string): Promise<string[]> {
  const userId = getCurrentUserId();
  const chunks = await prisma.$queryRaw<Array<{ content_hash: string }>>`
    SELECT content_hash FROM knowledge_chunks
    WHERE document_id = ${documentId}::uuid AND user_id = ${userId}::uuid
  `;
  return chunks.map(c => c.content_hash);
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

// 批量更新 Embedding（性能优化）
export async function updateChunkEmbeddingsBatch(
  updates: Array<{ chunkId: string; embedding: number[]; embeddingModel: string }>
): Promise<void> {
  if (updates.length === 0) return;

  const userId = getCurrentUserId();

  // 使用事务批量更新
  await prisma.$transaction(
    updates.map(({ chunkId, embedding, embeddingModel }) => {
      const embeddingStr = formatVectorForDb(embedding);
      return prisma.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${embeddingStr}::vector,
            embedding_model = ${embeddingModel},
            updated_at = now()
        WHERE id = ${chunkId}::uuid AND user_id = ${userId}::uuid
      `;
    })
  );
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
    orderBy: { createdAt: 'asc' },
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

export async function semanticSearch(
  queryEmbedding: number[],
  params: HybridSearchInput
): Promise<SearchResultDto[]> {
  const userId = getCurrentUserId();
  const embeddingStr = formatVectorForDb(queryEmbedding);
  const currentVersion = ragConfig.EMBEDDING_VERSION ?? 1;

  const tagFilter = params.tags && params.tags.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(d.tags_json) tag
          WHERE tag IN (${Prisma.join(params.tags)})
        )
      `
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

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
      1 - (c.embedding <=> ${embeddingStr}::vector) as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND c.embedding IS NOT NULL
      AND c.embedding_version = ${currentVersion}
      AND d.status = 'indexed'
      ${tagFilter}
      ${docFilter}
    ORDER BY c.embedding <=> ${embeddingStr}::vector
    LIMIT ${params.limit * 2}
  `;

  return results.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'semantic',
    sourceInfo: r.source,
  }));
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

  const tagFilter = params.tags && params.tags.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(d.tags_json) tag
          WHERE tag IN (${Prisma.join(params.tags)})
        )
      `
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

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
        d.title as document_title,
        d.source,
        (
          SELECT COUNT(*)::float FROM unnest(${patterns}::text[]) p
          WHERE c.content ILIKE p
        ) / ${tokens.length} as score
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.user_id = ${userId}::uuid
        AND d.status = 'indexed'
        AND c.content ILIKE ANY (${patterns}::text[])
        ${tagFilter}
        ${docFilter}
      ORDER BY score DESC
      LIMIT ${params.limit * 2}
    `;

    return results.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      headingChain: r.heading_chain ?? undefined,
      content: r.content,
      chunkIndex: r.chunk_index,
      score: Number(r.score),
      source: 'keyword',
      sourceInfo: r.source,
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
      d.title as document_title,
      d.source,
      similarity(c.content, ${query}) as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND d.status = 'indexed'
      AND c.content % ${query}
      ${tagFilter}
      ${docFilter}
    ORDER BY score DESC
    LIMIT ${params.limit * 2}
  `;

  return results.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'keyword',
    sourceInfo: r.source,
  }));
}

// =====================================================
// BM25 全文检索（tsvector + tsquery）
// =====================================================

export async function bm25Search(
  query: string,
  params: HybridSearchInput
): Promise<SearchResultDto[]> {
  const userId = getCurrentUserId();

  const tagFilter = params.tags && params.tags.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(d.tags_json) tag
          WHERE tag IN (${Prisma.join(params.tags)})
        )
      `
    : Prisma.empty;

  const docFilter = params.documentIds && params.documentIds.length > 0
    ? Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

  // 构建查询词：按空格和标点分词，使用 OR 连接
  const queryTerms = query.split(/[，。；：！？\s+]/).filter(t => t.length > 0);
  if (queryTerms.length === 0) return [];

  const tsqueryStr = queryTerms.join(' | ');

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
      ts_rank_cd(c.content_tsvector, to_tsquery('simple', ${tsqueryStr}), 32) as score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.user_id = ${userId}::uuid
      AND d.status = 'indexed'
      AND c.content_tsvector IS NOT NULL
      AND c.content_tsvector @@ to_tsquery('simple', ${tsqueryStr})
      ${tagFilter}
      ${docFilter}
    ORDER BY score DESC
    LIMIT ${params.limit * 2}
  `;

  return results.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    headingChain: r.heading_chain ?? undefined,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: Number(r.score),
    source: 'keyword' as const,
    sourceInfo: r.source,
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