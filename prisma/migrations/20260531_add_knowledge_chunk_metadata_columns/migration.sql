ALTER TABLE "knowledge_chunks"
ADD COLUMN IF NOT EXISTS "heading_chain" TEXT;

ALTER TABLE "knowledge_chunks"
ADD COLUMN IF NOT EXISTS "heading_level" INTEGER;

ALTER TABLE "knowledge_chunks"
ADD COLUMN IF NOT EXISTS "embedding_dimensions" INTEGER;

ALTER TABLE "knowledge_chunks"
ADD COLUMN IF NOT EXISTS "embedding_version" INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_version_idx"
ON "knowledge_chunks"("embedding_version");
