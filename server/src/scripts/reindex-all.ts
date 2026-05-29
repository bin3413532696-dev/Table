/**
 * 重建索引脚本：全量重建所有文档索引（使用小块大块架构）
 *
 * 执行方式：npx ts-node server/src/scripts/reindex-all.ts
 *
 * 功能：
 * 1. 查询所有已索引的文档
 * 2. 清理旧的 chunk 数据
 * 3. 使用新的分层 chunking 重新索引
 */

import { PrismaClient } from '@prisma/client';
import { chunkDocumentHierarchical, getHierarchicalChunkStats } from '../modules/knowledge-rag/indexing/chunker';
import { createEmbedder } from '../modules/knowledge-rag/indexing/embedder';
import { ragConfig } from '../modules/knowledge-rag/config';

const prisma = new PrismaClient();

// 并发控制
const BATCH_SIZE = 5;  // 每批处理的文档数

async function reindexDocument(doc: { id: string; userId: string; content: string | null; fileType: string | null }) {
  console.log(`[重建索引] 文档 ${doc.id} 开始处理...`);

  // 检查内容是否存在
  if (!doc.content) {
    console.warn(`[重建索引] 文档 ${doc.id} 无内容，跳过`);
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'failed' },
    });
    return { success: false, error: '无内容' };
  }

  try {
    // 清理旧的 chunk 数据
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId: doc.id, userId: doc.userId },
    });

    // 使用分层 chunking
    const fileType = doc.fileType ?? 'txt';
    const hierarchicalResult = await chunkDocumentHierarchical(doc.content, fileType);

    if (hierarchicalResult.childChunks.length === 0) {
      console.warn(`[重建索引] 文档 ${doc.id} 无法分块，跳过`);
      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: 'failed' },
      });
      return;
    }

    // 统计信息
    const stats = getHierarchicalChunkStats(hierarchicalResult);
    console.log(`[重建索引] 文档 ${doc.id}: ${stats.parentCount} 大块, ${stats.childCount} 小块`);

    const now = new Date();

    // 存储大块
    await prisma.knowledgeChunk.createMany({
      data: hierarchicalResult.parentChunks.map(p => ({
        id: p.id,
        documentId: doc.id,
        userId: doc.userId,
        content: p.content,
        contentHash: p.contentHash,
        chunkIndex: p.chunkIndex,
        startPos: p.startPos,
        endPos: p.endPos,
        headingChain: p.headingChain,
        headingLevel: p.headingLevel,
        chunkType: 'parent',
        parentId: null,
        createdAt: now,
        updatedAt: now,
      })),
    });

    // 存储小块
    await prisma.knowledgeChunk.createMany({
      data: hierarchicalResult.childChunks.map(c => ({
        id: c.id,
        documentId: doc.id,
        userId: doc.userId,
        content: c.content,
        contentHash: c.contentHash,
        chunkIndex: c.chunkIndex,
        startPos: c.startPos,
        endPos: c.endPos,
        headingChain: c.headingChain,
        headingLevel: c.headingLevel,
        chunkType: 'small',
        parentId: c.parentId,
        embeddingDimensions: ragConfig.EMBEDDING_DIMENSIONS,
        embeddingVersion: ragConfig.EMBEDDING_VERSION ?? 1,
        createdAt: now,
        updatedAt: now,
      })),
    });

    // 为小块生成 embedding
    const embedder = await createEmbedder();
    const embeddingResults = await embedder.embedChunksBatch(
      hierarchicalResult.childChunks.map(c => ({ content: c.content, contentHash: c.contentHash }))
    );

    // 写入 embedding（批量更新）
    const embeddingUpdates = embeddingResults.map((r, i) => ({
      chunkId: hierarchicalResult.childChunks[i].id,
      embedding: r.embedding,
      embeddingModel: ragConfig.EMBEDDING_MODEL,
    }));

    // 使用原始 SQL 批量更新 embedding（避免 Prisma Unsupported 类型问题）
    for (const update of embeddingUpdates) {
      const embeddingStr = `[${update.embedding.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${embeddingStr}::vector, embedding_model = ${update.embeddingModel}
        WHERE id = ${update.chunkId}::uuid
      `;
    }

    // 更新文档状态
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        status: 'indexed',
        updatedAt: now,
      },
    });

    console.log(`[重建索引] 文档 ${doc.id} 完成，embedding ${embeddingUpdates.length} 个`);
    return { success: true };
  } catch (error) {
    console.error(`[重建索引] 文档 ${doc.id} 失败:`, error);
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'failed' },
    });
    return { success: false, error };
  }
}

async function main() {
  console.log('=== 开始全量重建索引 ===');
  console.log(`时间: ${new Date().toISOString()}`);

  // 查询所有已索引的文档
  const documents = await prisma.knowledgeDocument.findMany({
    where: { status: 'indexed' },
    select: { id: true, userId: true, content: true, fileType: true },
  });

  console.log(`待处理文档数: ${documents.length}`);

  if (documents.length === 0) {
    console.log('没有需要重建的文档');
    return;
  }

  // 批量处理
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);

    // 串行处理一批（避免 embedding API 过载）
    for (const doc of batch) {
      const result = await reindexDocument(doc);
      if (result && result.success) {
        processed++;
      } else {
        failed++;
      }
    }

    console.log(`进度: ${processed}/${documents.length}, 失败: ${failed}`);

    // 等待一下，避免过载
    if (i + BATCH_SIZE < documents.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('=== 重建索引完成 ===');
  console.log(`成功: ${processed}, 失败: ${failed}`);
  console.log(`时间: ${new Date().toISOString()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());