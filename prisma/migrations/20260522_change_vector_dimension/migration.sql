-- 将向量维度从1536改为1024，适配bge-m3模型
-- 删除旧索引
DROP INDEX IF EXISTS knowledge_chunks_embedding_idx;

-- 修改向量列维度
ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);

-- 重建HNSW索引
CREATE INDEX knowledge_chunks_embedding_idx
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WHERE embedding IS NOT NULL;

-- 修改embedding缓存表
ALTER TABLE knowledge_embedding_cache ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);