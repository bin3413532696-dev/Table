import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  listDocuments,
  findDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  listChunks,
  createChunks,
  deleteChunksByDocument,
  deleteChunksByHash,      // 新增
  getChunkHashes,          // 新增
  getChunksWithoutEmbedding,
  updateChunkEmbedding,
  updateChunkEmbeddingsBatch,
  listJobs,
  findJobById,
  createJob,
  updateJobStatus,
  getRagStats,
  resetStaleJobs,
  listDocumentsWithCount,
  listJobsWithCount,
  listChunksWithCount,
  getChunkById,            // 新增：用于 chunk_read 工具
} from './repository';
import { parseDocument, getFileType, computeFileHash, cleanTextContent, computeContentHash } from './indexing/document-parser';
import { chunkDocument, getChunkStats, CHUNK_STRATEGIES } from './indexing/chunker';
import { embedChunks, embedQuery, createEmbedder } from './indexing/embedder';
import { jobQueue } from './indexing/job-queue';
import { hybridSearch, buildLLMContext, formatContextForAgent } from './retrieval';
import { ragConfig } from './config';
import type { SearchResultDto } from './dto';
import type {
  CreateDocumentInput,
  UpdateDocumentInput,
  ListDocumentsQuery,
  ListChunksQuery,
  ListJobsQuery,
  HybridSearchInput,
  TriggerIndexInput,
} from './schema';

// 存储目录（使用绝对路径，默认在 server/data/uploads）
const UPLOAD_DIR = process.env.RAG_UPLOAD_DIR || path.resolve(process.cwd(), 'server', 'data', 'uploads');

// 并发索引控制：跟踪正在处理的文档
const activeIndexingDocs = new Set<string>();
const MAX_CONCURRENT_INDEXING = 3;
const activeIndexingCount = { value: 0 };

// 确保上传目录存在
async function ensureUploadDir(userId: string): Promise<string> {
  const userDir = path.join(UPLOAD_DIR, userId);
  await fs.mkdir(userDir, { recursive: true });
  return userDir;
}

// =====================================================
// 文档服务
// =====================================================

export async function getDocuments(query: ListDocumentsQuery) {
  return listDocumentsWithCount(query);
}

export async function getDocument(id: string) {
  return findDocumentById(id);
}

export async function uploadDocument(
  userId: string,
  file: MultipartFile,
  title?: string,
  tags?: string[]
) {
  // 验证文件类型
  const ext = path.extname(file.filename).toLowerCase();
  const fileType = getFileType(ext);

  if (!fileType) {
    throw new Error(`不支持的文件类型: ${ext}`);
  }

  // 保存文件
  const userDir = await ensureUploadDir(userId);
  const docId = crypto.randomUUID();
  const fileName = `${docId}${ext}`;
  const filePath = path.join(userDir, fileName);

  const buffer = await file.toBuffer();

  // 验证文件大小
  const maxSize = ragConfig.INDEX_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (buffer.length > maxSize) {
    throw new Error(`文件过大，最大支持 ${ragConfig.INDEX_MAX_FILE_SIZE_MB}MB`);
  }

  await fs.writeFile(filePath, buffer);

  // 计算哈希
  const fileHash = await computeFileHash(filePath);

  // 解析文件
  const parseResult = await parseDocument(filePath, fileType);
  const cleanedContent = cleanTextContent(parseResult.content);

  // 创建文档记录
  const input: CreateDocumentInput = {
    title: title ?? parseResult.metadata.title ?? file.filename,
    fileType,
    source: file.filename,
    tags: tags ?? [],
  };

  const doc = await createDocument(input, cleanedContent, fileHash, buffer.length);

  // 创建索引任务
  const job = await createJob(doc.id, 'full_index');

  // 执行索引（异步）
  executeIndexingAsync(doc.id, job.id, filePath, fileType, cleanedContent).catch((error) => {
    console.error(`索引任务失败 [${doc.id}]:`, error);
    // 错误已通过 jobQueue.markFailed 记录到数据库，前端可通过轮询获取状态
  });

  return { document: doc, job };
}

export async function updateDocumentService(id: string, input: UpdateDocumentInput) {
  return updateDocument(id, input);
}

export async function deleteDocumentService(id: string) {
  // 删除分块
  await deleteChunksByDocument(id);
  // 删除文档
  return deleteDocument(id);
}

// =====================================================
// 索引服务
// =====================================================

async function executeIndexingAsync(
  documentId: string,
  jobId: string,
  filePath: string | null,
  fileType: string,
  content: string
): Promise<void> {
  // 获取分块策略配置
  const strategy = CHUNK_STRATEGIES[fileType] ?? CHUNK_STRATEGIES.txt;

  // 检查 Job 状态是否已被其他进程处理
  const currentJob = await findJobById(jobId);
  if (!currentJob || currentJob.status !== 'pending') {
    console.log(`Job ${jobId} already processed or not found, skipping`);
    return;
  }

  // 并发控制：检查是否已有相同文档正在索引
  if (activeIndexingDocs.has(documentId)) {
    await jobQueue.markFailed(jobId, { message: '文档正在索引中，请勿重复操作' });
    return;
  }

  // 检查并发数量限制
  if (activeIndexingCount.value >= MAX_CONCURRENT_INDEXING) {
    await jobQueue.markFailed(jobId, { message: '索引任务过多，请稍后重试' });
    return;
  }

  // 标记为正在处理
  activeIndexingDocs.add(documentId);
  activeIndexingCount.value++;

  try {
    await jobQueue.markRunning(jobId);
    await updateDocumentStatus(documentId, 'processing');

    // 分块（传递 fileType 以选择合适的分块策略）
    await jobQueue.updateProgress(jobId, 10);
    const chunks = await chunkDocument(content, fileType);

    if (chunks.length === 0) {
      throw new Error('文档内容无法分块');
    }

    // 分片质量监控：记录统计信息
    const stats = getChunkStats(chunks);
    console.log(`[索引监控] 文档 ${documentId}: ${stats.count} chunks, 平均 ${stats.avgLength} 字符, 范围 [${stats.minLength}, ${stats.maxLength}]`);
    if (stats.minLength < 100) {
      console.warn(`[索引警告] 存在极小 chunk (${stats.minLength} 字符)，可能影响检索质量`);
    }
    if (stats.maxLength > strategy.chunkSize * 2) {
      console.warn(`[索引警告] 存在超大 chunk (${stats.maxLength} 字符)，可能超出 embedding 限制`);
    }

    // P4 增量索引：基于 content hash 判断是否需要更新
    const existingHashes = await getChunkHashes(documentId);
    const newChunkHashes = chunks.map(c => c.contentHash);

    // 需要新增的 chunks
    const chunksToInsert = chunks.filter(c => !existingHashes.includes(c.contentHash));
    // 需要删除的 chunks（不再存在的）
    const hashesToDelete = existingHashes.filter(h => !newChunkHashes.includes(h));

    console.log(`[增量索引] 新增 ${chunksToInsert.length} chunks, 删除 ${hashesToDelete.length} chunks`);

    // 删除不再存在的 chunks
    if (hashesToDelete.length > 0) {
      await deleteChunksByHash(documentId, hashesToDelete);
    }

    // 创建新分块（包含 headingChain 和 embedding 信息）
    await jobQueue.updateProgress(jobId, 20);
    if (chunksToInsert.length > 0) {
      await createChunks(documentId, chunksToInsert.map(c => ({
        id: c.id,
        content: c.content,
        contentHash: c.contentHash,
        chunkIndex: c.chunkIndex,
        startPos: c.startPos,
        endPos: c.endPos,
        headingChain: c.headingChain,
        headingLevel: c.headingLevel,
        embeddingDimensions: ragConfig.EMBEDDING_DIMENSIONS,
        embeddingVersion: ragConfig.EMBEDDING_VERSION ?? 1,
      })));
    }

    // 生成 Embedding（只对新 chunks）
    await jobQueue.updateProgress(jobId, 30);
    if (chunksToInsert.length > 0) {
      const embedder = await createEmbedder();
      const embeddingResults = await embedder.embedChunksBatch(chunksToInsert.map(c => ({
        content: c.content,
        contentHash: c.contentHash,
      })));

      // 存储 Embedding
      await jobQueue.updateProgress(jobId, 70);
      const chunkMap = new Map(chunksToInsert.map(c => [c.contentHash, c]));
      const embeddingUpdates = embeddingResults
        .map(result => {
          const chunk = chunkMap.get(result.contentHash);
          if (chunk) {
            return {
              chunkId: chunk.id,
              embedding: result.embedding,
              embeddingModel: ragConfig.EMBEDDING_MODEL,
            };
          }
          return null;
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);

      await updateChunkEmbeddingsBatch(embeddingUpdates);
    }

    // 完成
    await jobQueue.updateProgress(jobId, 90);
    const summary = content.slice(0, 200) + (content.length > 200 ? '...' : '');
    await updateDocumentStatus(documentId, 'indexed', summary);
    await jobQueue.markCompleted(jobId);

    // 清理临时文件（仅在 filePath 非空时）
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn(`清理临时文件失败 ${filePath}:`, err);
      }
    }
  } catch (error) {
    await jobQueue.markFailed(jobId, error);
    await updateDocumentStatus(documentId, 'failed');
    console.error(`索引失败 [${documentId}]:`, error);
  } finally {
    // 释放并发控制锁
    activeIndexingDocs.delete(documentId);
    activeIndexingCount.value--;
  }
}

export async function triggerIndex(id: string, input: TriggerIndexInput) {
  const doc = await findDocumentById(id);
  if (!doc) {
    throw new Error('文档不存在');
  }

  if (!input.force && doc.status === 'indexed') {
    return { message: '文档已索引，无需重新索引' };
  }

  // 创建任务
  const job = await createJob(id, 'reindex');

  // 执行索引
  const contentHash = await computeContentHash(doc.content);
  executeIndexingAsync(id, job.id, null as any, doc.fileType ?? 'txt', doc.content).catch((error) => {
    console.error(`重新索引任务启动失败 [${id}]:`, error);
  });

  return { job };
}

export async function getJobs(query: ListJobsQuery) {
  return listJobsWithCount(query);
}

export async function getJob(id: string) {
  return findJobById(id);
}

export async function getStats() {
  return getRagStats();
}

// =====================================================
// 分块服务
// =====================================================

export async function getChunks(query: ListChunksQuery) {
  return listChunksWithCount(query);
}

export async function backfillEmbeddings(documentId: string): Promise<{ count: number }> {
  // 验证文档归属
  const doc = await findDocumentById(documentId);
  if (!doc) {
    throw new Error('文档不存在');
  }

  const chunks = await getChunksWithoutEmbedding(documentId);

  if (chunks.length === 0) {
    return { count: 0 };
  }

  const embedder = await createEmbedder();
  const results = await embedder.embedChunksBatch(chunks.map(c => ({
    content: c.content,
    contentHash: c.contentHash,
  })));

  // 批量写入
  const chunkMap = new Map(chunks.map(c => [c.contentHash, c]));
  const updates = results
    .map(result => {
      const chunk = chunkMap.get(result.contentHash);
      if (chunk) {
        return {
          chunkId: chunk.id,
          embedding: result.embedding,
          embeddingModel: ragConfig.EMBEDDING_MODEL,
        };
      }
      return null;
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);

  await updateChunkEmbeddingsBatch(updates);

  return { count: results.length };
}

// =====================================================
// 搜索服务
// =====================================================

export async function search(params: HybridSearchInput) {
  return hybridSearch(params);
}

export async function searchWithContext(params: HybridSearchInput) {
  const result = await hybridSearch(params);
  const context = buildLLMContext(result.results, 4000);
  return { ...result, context };
}

export async function searchForAgent(query: string, limit: number = 10): Promise<string> {
  const result = await hybridSearch({
    query,
    mode: 'hybrid',
    limit,
    threshold: ragConfig.SEARCH_MIN_THRESHOLD,
    fusionWeight: ragConfig.SEARCH_FUSION_WEIGHT,
    enableRerank: false,
    rerankerThreshold: undefined,
    useBm25: false,
    enableQueryPreprocess: false,
    enableExpansion: false,
    enableRewrite: false,
    enableMmr: false,
    mmrLambda: undefined,
  });

  return formatContextForAgent(result.results);
}

/**
 * Agent 结构化搜索（返回 SearchResultDto[]，保留 chunk ID）
 * 用于 semantic_search / keyword_search 工具
 */
export async function searchForAgentStructured(params: HybridSearchInput): Promise<{
  results: SearchResultDto[];
  maxScore: number;
}> {
  const result = await hybridSearch({
    ...params,
    threshold: params.threshold ?? ragConfig.SEARCH_MIN_THRESHOLD,
    fusionWeight: params.fusionWeight ?? ragConfig.SEARCH_FUSION_WEIGHT,
    // 默认启用高级功能（可通过配置覆盖）
    enableRerank: params.enableRerank ?? ragConfig.RERANKER_ENABLED_BY_DEFAULT ?? true,
    rerankerThreshold: params.rerankerThreshold ?? ragConfig.RERANKER_MIN_SCORE,
    useBm25: params.useBm25 ?? false,
    enableQueryPreprocess: params.enableQueryPreprocess ?? ragConfig.QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT ?? false,
    enableExpansion: params.enableExpansion ?? false,
    enableRewrite: params.enableRewrite ?? true,
    enableMmr: params.enableMmr ?? ragConfig.MMR_ENABLED_BY_DEFAULT ?? false,
    mmrLambda: params.mmrLambda ?? ragConfig.MMR_LAMBDA,
  });

  // 使用原始语义搜索最高分数，用于 Retrieval Grader 判断
  // 如果语义搜索无结果，使用融合后的最高分数（可能是关键词搜索结果）
  const maxScore = result.originalSemanticMaxScore > 0
    ? result.originalSemanticMaxScore
    : (result.results.length > 0 ? Math.max(...result.results.map(r => r.score)) : 0);

  return {
    results: result.results,
    maxScore,
  };
}

// =====================================================
// 辅助：创建分块（内部使用）
// =====================================================

// =====================================================
// 导出 repository 函数（供 Agent 工具使用）
// =====================================================

export { getChunkById } from './repository';

// =====================================================
// Job 恢复机制
// =====================================================

export async function initializeJobRecovery(): Promise<void> {
  try {
    // 重置所有超时的 running Job（超过30分钟未完成）
    const resetCount = await resetStaleJobs(30);
    if (resetCount > 0) {
      console.log(`Job recovery: reset ${resetCount} stale jobs`);
    }

    // 将卡在 processing 状态的文档重置为 failed
    const { prisma } = await import('../../db/client');
    const docResult = await prisma.knowledgeDocument.updateMany({
      where: {
        status: 'processing',
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      data: { status: 'failed', updatedAt: new Date() },
    });
    if (docResult.count > 0) {
      console.log(`Job recovery: reset ${docResult.count} stale documents`);
    }
  } catch (error) {
    console.error('Job recovery failed:', error);
  }
}