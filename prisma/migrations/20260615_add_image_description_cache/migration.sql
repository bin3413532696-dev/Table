-- VLM 图片描述缓存：相同图片（content_hash 一致）跨文档复用 VLM 描述结果

CREATE TABLE knowledge_image_description_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  description TEXT NOT NULL,
  model TEXT NOT NULL,
  source_kind TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX knowledge_image_description_cache_unique_idx
ON knowledge_image_description_cache (user_id, content_hash, model);

CREATE INDEX knowledge_image_description_cache_hash_idx
ON knowledge_image_description_cache (content_hash);

CREATE INDEX knowledge_image_description_cache_expires_idx
ON knowledge_image_description_cache (expires_at);
