-- 启用 pg_trgm 扩展用于中文模糊搜索
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 trigram 索引用于分块内容搜索
CREATE INDEX knowledge_chunks_content_trgm_idx
ON knowledge_chunks
USING gin (content gin_trgm_ops);

-- 创建 trigram 索引用于文档标题搜索
CREATE INDEX knowledge_documents_title_trgm_idx
ON knowledge_documents
USING gin (title gin_trgm_ops);

-- 设置 similarity threshold 默认值（0.3 与应用配置一致）
ALTER DATABASE postgres SET pg_trgm.similarity_threshold = 0.3;