/**
 * 为现有文档生成 Embedding
 */
import 'dotenv/config';

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('========================================');
  console.log('为现有文档生成 Embedding');
  console.log('========================================\n');

  const { prisma } = await import('./src/db/client');
  const { createEmbedder } = await import('./src/modules/knowledge-rag/indexing/embedder');
  const { ragConfig } = await import('./src/modules/knowledge-rag/config');

  const userId = DEFAULT_USER_ID;

  // 1. 查找没有 embedding 的 chunks
  console.log('[1] 查找没有 embedding 的 chunks...');
  const chunksWithoutEmbedding = await prisma.$queryRaw<Array<{
    id: string;
    document_id: string;
    content: string;
    content_hash: string;
  }>>`
    SELECT kc.id, kc.document_id, kc.content, kc.content_hash
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE kd.user_id = ${userId}::uuid AND kc.embedding IS NULL
    LIMIT 20
  `;
  console.log('找到 chunks:', chunksWithoutEmbedding.length);

  if (chunksWithoutEmbedding.length === 0) {
    console.log('没有需要生成 embedding 的 chunks');
    await prisma.$disconnect();
    return;
  }

  // 2. 创建 embedder
  console.log('\n[2] 创建 Embedder...');
  const embedder = await createEmbedder();
  console.log('Embedder 模型:', embedder['embeddingModel']);

  // 3. 生成 embedding
  console.log('\n[3] 生成 Embedding...');
  const chunkContents = chunksWithoutEmbedding.map(c => ({
    content: c.content,
    contentHash: c.content_hash,
  }));

  const embeddingResults = await embedder.embedChunksBatch(chunkContents);
  console.log('生成 embedding 数量:', embeddingResults.length);

  // 4. 存储 embedding
  console.log('\n[4] 存储 Embedding 到数据库...');
  for (const result of embeddingResults) {
    const chunk = chunksWithoutEmbedding.find(c => c.content_hash === result.contentHash);
    if (chunk) {
      // 使用 raw SQL 更新 embedding（因为 Prisma 不支持 vector 类型）
      const embeddingStr = '[' + result.embedding.join(',') + ']';
      await prisma.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${embeddingStr}::vector,
            embedding_model = ${embedder['embeddingModel']},
            embedding_dimensions = ${ragConfig.EMBEDDING_DIMENSIONS},
            embedding_version = ${ragConfig.EMBEDDING_VERSION ?? 1},
            updated_at = NOW()
        WHERE id = ${chunk.id}::uuid
      `;
      console.log('  更新 chunk:', chunk.id.slice(0, 8));
    }
  }

  // 5. 验证结果
  console.log('\n[5] 验证 embedding...');
  const afterChunks = await prisma.$queryRaw<Array<{ total: bigint; with_emb: bigint }>>`
    SELECT COUNT(*) as total, COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_emb
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE kd.user_id = ${userId}::uuid
  `;
  console.log('结果:', {
    total: Number(afterChunks[0]?.total ?? 0),
    withEmbedding: Number(afterChunks[0]?.with_emb ?? 0),
  });

  await prisma.$disconnect();
  console.log('\n========================================');
  console.log('完成');
  console.log('========================================');
}

main().catch(console.error);