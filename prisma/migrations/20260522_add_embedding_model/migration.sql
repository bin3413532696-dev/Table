-- 为 ApiProvider 表添加 embedding_model 字段
ALTER TABLE api_providers ADD COLUMN embedding_model TEXT;

-- 注释
COMMENT ON COLUMN api_providers.embedding_model IS 'Embedding模型名称，用于RAG知识库检索';