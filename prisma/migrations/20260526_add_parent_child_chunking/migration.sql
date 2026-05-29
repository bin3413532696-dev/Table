-- 小块大块架构：添加 parentId 和 chunkType 字段
-- parentId: 小块关联大块的ID
-- chunkType: 区分 "small"（小块）和 "parent"（大块）

-- 添加 parentId 字段（可空，小块才需要关联大块）
ALTER TABLE "knowledge_chunks" ADD COLUMN "parent_id" UUID NULL;

-- 添加 chunkType 字段（默认 small）
ALTER TABLE "knowledge_chunks" ADD COLUMN "chunk_type" VARCHAR(255) NOT NULL DEFAULT 'small';

-- 添加索引
CREATE INDEX "knowledge_chunks_parent_id_idx" ON "knowledge_chunks"("parent_id");
CREATE INDEX "knowledge_chunks_document_type_idx" ON "knowledge_chunks"("document_id", "chunk_type");

-- 添加外键约束（小块的 parentId 必须指向同文档的大块）
ALTER TABLE "knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "knowledge_chunks"("id")
  ON DELETE CASCADE;