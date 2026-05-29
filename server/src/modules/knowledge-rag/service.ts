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
  getChunkIdsByHash,       // 新增：获取已存在 chunks 的真实 ID
  getChunksWithoutEmbedding,
  updateChunkEmbedding,
  updateChunkEmbeddingsBatch,
  findEmbeddingCacheBatch, // 新增
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
import { parseDocument, getFileType, computeFileHash, computeContentHash } from './indexing/document-parser';
import {
  chunkDocument,
  chunkDocumentHierarchical,
  getChunkStats,
  getHierarchicalChunkStats,
  CHUNK_STRATEGIES,
  type HierarchicalChunkResult,
} from './indexing/chunker';
import { embedChunks, embedQuery, createEmbedder } from './indexing/embedder';
import { jobQueue } from './indexing/job-queue';
import { hybridSearch, buildLLMContext, formatContextForAgent } from './retrieval';
import { ragConfig } from './config';
import { extractMetadata } from './indexing/metadata-extractor';
import { cleanDocumentText, getParseQualityLevel } from './indexing/text-cleaner';
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
  const { cleanedText, qualityScore, stats: cleaningStats } = cleanDocumentText(parseResult.content);

  // 解析质量日志
  const parseQualityLevel = getParseQualityLevel(qualityScore);
  console.log(`[文档解析] ${docId}: 质量=${parseQualityLevel} (${qualityScore.toFixed(2)}), `
              + `原始=${cleaningStats.originalLength}字符, 清洗后=${cleaningStats.cleanedLength}字符, `
              + `移除=${cleaningStats.removedChars}字符`);

  if (cleaningStats.headerFooterLines > 0 || cleaningStats.pageNumbersRemoved > 0) {
    console.log(`[文档解析] ${docId}: 移除页眉页脚=${cleaningStats.headerFooterLines}行, 页码=${cleaningStats.pageNumbersRemoved}处`);
  }

  // 提取元数据（使用 LLM 分类）
  const extractedMetadata = await extractMetadata({
    title: title ?? parseResult.metadata.title ?? file.filename,
    content: cleanedText,
    parseResult,
    filename: file.filename,
    useLlm: true,
  });

  // 创建文档记录（包含元数据）
  const input: CreateDocumentInput = {
    title: title ?? parseResult.metadata.title ?? file.filename,
    fileType,
    source: file.filename,
    tags: tags ?? [],
  };

  const doc = await createDocument(
    input,
    cleanedText,
    fileHash,
    buffer.length,
    {
      publishDate: extractedMetadata.publishDate,
      sourceDept: extractedMetadata.sourceDept,
      securityLevel: extractedMetadata.securityLevel,
      businessCategory: extractedMetadata.businessCategory,
      docLanguage: extractedMetadata.docLanguage,
      originalMetadata: parseResult.metadata,
    }
  );

  // 创建索引任务
  const job = await createJob(doc.id, 'full_index');

  // 执行索引（异步）
  executeIndexingAsync(doc.id, job.id, filePath, fileType, cleanedText).catch((error) => {
    console.error(`索引任务失败 [${doc.id}]:`, error);
    // 错误已通过 jobQueue.markFailed 记录到数据库，前端可通过轮询获取状态
  });

  return { document: doc, job, metadata: extractedMetadata, cleaningStats, parseQuality: parseQualityLevel };
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

    // 分块（使用分层chunking：小块大块架构）
    await jobQueue.updateProgress(jobId, 10);
    const hierarchicalResult = await chunkDocumentHierarchical(content, fileType);

    if (hierarchicalResult.childChunks.length === 0) {
      throw new Error('文档内容无法分块');
    }

    // 分片质量监控：记录统计信息
    const stats = getHierarchicalChunkStats(hierarchicalResult);
    console.log(`[索引监控] 文档 ${documentId}: ${stats.parentCount} 大块, ${stats.childCount} 小块, `
                + `大块平均 ${stats.avgParentLength} 字符, 小块平均 ${stats.avgChildLength} 字符`);

    // P4 增量索引：基于 content hash 判断是否需要更新
    // 只检查小块的 hash（小块用于检索，需要精确匹配）
    const existingHashes = await getChunkHashes(documentId, 'small');  // 只获取小块的 hash
    const newChildHashes = hierarchicalResult.childChunks.map(c => c.contentHash);

    // 需要新增的小块
    const childChunksToInsert = hierarchicalResult.childChunks.filter(c => !existingHashes.includes(c.contentHash));
    // 需要删除的小块（不再存在的）
    const hashesToDelete = existingHashes.filter(h => !newChildHashes.includes(h));

    console.log(`[增量索引] 新增 ${childChunksToInsert.length} 小块, 删除 ${hashesToDelete.length} 小块`);

    // 删除不再存在的小块（同时删除关联的大块）
    if (hashesToDelete.length > 0) {
      await deleteChunksByHash(documentId, hashesToDelete);
    }

    // 存储大块（parent chunks）
    await jobQueue.updateProgress(jobId, 15);
    const parentChunksToInsert = hierarchicalResult.parentChunks.map(p => ({
      id: p.id,
      content: p.content,
      contentHash: p.contentHash,
      chunkIndex: p.chunkIndex,
      startPos: p.startPos,
      endPos: p.endPos,
      headingChain: p.headingChain,
      headingLevel: p.headingLevel,
      chunkType: 'parent',
      parentId: null,
      // 大块不生成 embedding，以下字段为 null
      embeddingDimensions: null,
      embeddingVersion: null,
    }));

    await createChunks(documentId, parentChunksToInsert);
    console.log(`[索引] 创建 ${parentChunksToInsert.length} 个大块`);

    // 存储小块（child chunks），关联大块
    await jobQueue.updateProgress(jobId, 20);
    if (childChunksToInsert.length > 0) {
      await createChunks(documentId, childChunksToInsert.map(c => ({
        id: c.id,
        content: c.content,
        contentHash: c.contentHash,
        chunkIndex: c.chunkIndex,
        startPos: c.startPos,
        endPos: c.endPos,
        headingChain: c.headingChain,
        headingLevel: c.headingLevel,
        chunkType: 'small',
        parentId: c.parentId,  // 关联大块
        embeddingDimensions: ragConfig.EMBEDDING_DIMENSIONS,
        embeddingVersion: ragConfig.EMBEDDING_VERSION ?? 1,
      })));
    }
    console.log(`[索引] 创建 ${childChunksToInsert.length} 个小块`);

    // === 处理 embedding（只为小块生成）===
    // 1. 新小块需要 embedding
    // 2. 已存在的小块如果没有 embedding 也需要补充（优先使用缓存）
    await jobQueue.updateProgress(jobId, 30);

    // 收集所有需要写入 embedding 的数据
    const embeddingUpdates: Array<{ chunkId: string; embedding: number[]; embeddingModel: string }> = [];

    // 新小块：需要生成 embedding
    const newChunksToEmbed = childChunksToInsert.map(c => ({
      content: c.content,
      contentHash: c.contentHash,
      chunkId: c.id,
    }));

    // 现有小块但无 embedding（通过缓存查询判断）
    const existingChildChunks = hierarchicalResult.childChunks.filter(c =>
      existingHashes.includes(c.contentHash) && !childChunksToInsert.some(nc => nc.id === c.id)
    );

    if (existingChildChunks.length > 0) {
      // 获取已存在小块的真实数据库 ID
      const existingHashesToProcess = existingChildChunks.map(c => c.contentHash);
      const dbChunkIdMap = await getChunkIdsByHash(documentId, existingHashesToProcess);

      // 检查这些小块是否已有 embedding 缓存
      const cacheMap = await findEmbeddingCacheBatch(
        existingHashesToProcess,
        ragConfig.EMBEDDING_MODEL
      );

      for (const c of existingChildChunks) {
        const dbChunkId = dbChunkIdMap.get(c.contentHash);
        if (!dbChunkId) {
          console.warn(`[索引] 未找到小块的数据库 ID: ${c.contentHash}`);
          continue;
        }

        const cached = cacheMap.get(c.contentHash);
        if (cached) {
          // 有缓存：直接使用缓存的 embedding
          embeddingUpdates.push({
            chunkId: dbChunkId,
            embedding: cached,
            embeddingModel: ragConfig.EMBEDDING_MODEL,
          });
        } else {
          // 无缓存：需要生成 embedding
          newChunksToEmbed.push({
            content: c.content,
            contentHash: c.contentHash,
            chunkId: dbChunkId,
          });
        }
      }
    }

    // 生成所有需要新 embedding 的小块
    if (newChunksToEmbed.length > 0) {
      console.log(`[索引] 需要生成 embedding 的小块: ${newChunksToEmbed.length} 个`);
      const embedder = await createEmbedder();
      const embeddingResults = await embedder.embedChunksBatch(
        newChunksToEmbed.map(c => ({ content: c.content, contentHash: c.contentHash }))
      );

      // 构建 contentHash -> chunkId 的映射
      const newChunkMap = new Map(newChunksToEmbed.map(c => [c.contentHash, c.chunkId]));
      for (const result of embeddingResults) {
        const chunkId = newChunkMap.get(result.contentHash);
        if (chunkId) {
          embeddingUpdates.push({
            chunkId,
            embedding: result.embedding,
            embeddingModel: ragConfig.EMBEDDING_MODEL,
          });
        }
      }
    }

    // 写入所有 embedding（新生成 + 从缓存获取）
    if (embeddingUpdates.length > 0) {
      console.log(`[索引] 写入 embedding: ${embeddingUpdates.length} 个`);
      await jobQueue.updateProgress(jobId, 70);
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