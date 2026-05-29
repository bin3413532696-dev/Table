-- 为 knowledge_documents 的 tags_json JSONB 列添加 GIN 索引
-- 支持 jsonb_array_elements_text 展开查询的性能优化

-- GIN 索引（通用，支持所有 JSONB 操作符）
CREATE INDEX IF NOT EXISTS knowledge_documents_tags_gin_idx
ON knowledge_documents USING gin (tags_json);

-- jsonb_path_ops 索引（更紧凑，仅支持 @> 包含查询）
-- 对于标签过滤场景（检查数组是否包含某标签），此索引更高效
CREATE INDEX IF NOT EXISTS knowledge_documents_tags_path_idx
ON knowledge_documents USING gin (tags_json jsonb_path_ops);

-- 注：两个索引可以根据查询模式选择使用
-- - gin 索引支持 @>、?、?|、?& 等操作符
-- - jsonb_path_ops 仅支持 @>，但索引体积更小，查询更快