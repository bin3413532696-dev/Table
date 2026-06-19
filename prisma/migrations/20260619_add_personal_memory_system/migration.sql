CREATE TABLE "knowledge_corpora" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "default_tags_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "knowledge_corpora_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_corpora_user_id_idx" ON "knowledge_corpora"("user_id");
CREATE INDEX "knowledge_corpora_user_id_updated_at_idx" ON "knowledge_corpora"("user_id", "updated_at" DESC);

ALTER TABLE "knowledge_corpora"
ADD CONSTRAINT "knowledge_corpora_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "knowledge_corpus_documents" (
    "corpus_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "knowledge_corpus_documents_pkey" PRIMARY KEY ("corpus_id", "document_id")
);

CREATE INDEX "knowledge_corpus_documents_user_id_idx" ON "knowledge_corpus_documents"("user_id");
CREATE INDEX "knowledge_corpus_documents_document_id_idx" ON "knowledge_corpus_documents"("document_id");

ALTER TABLE "knowledge_corpus_documents"
ADD CONSTRAINT "knowledge_corpus_documents_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_corpus_documents"
ADD CONSTRAINT "knowledge_corpus_documents_corpus_id_fkey"
FOREIGN KEY ("corpus_id") REFERENCES "knowledge_corpora"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_corpus_documents"
ADD CONSTRAINT "knowledge_corpus_documents_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_memory_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "processed_at" TIMESTAMPTZ(6),
    CONSTRAINT "agent_memory_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_memory_events_user_id_idx" ON "agent_memory_events"("user_id");
CREATE INDEX "agent_memory_events_session_id_idx" ON "agent_memory_events"("session_id");
CREATE INDEX "agent_memory_events_run_id_idx" ON "agent_memory_events"("run_id");
CREATE INDEX "agent_memory_events_user_status_idx" ON "agent_memory_events"("user_id", "status");

ALTER TABLE "agent_memory_events"
ADD CONSTRAINT "agent_memory_events_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_memory_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "scope_type" VARCHAR(20) NOT NULL,
    "scope_id" VARCHAR(64) NOT NULL,
    "memory_kind" VARCHAR(20) NOT NULL,
    "memory_slot" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "salience" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "source_run_id" UUID,
    "source_document_id" UUID,
    "evidence_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "last_accessed_at" TIMESTAMPTZ(6),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "supersedes_id" UUID,
    "ttl_at" TIMESTAMPTZ(6),
    "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "agent_memory_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_memory_records_user_id_idx" ON "agent_memory_records"("user_id");
CREATE INDEX "agent_memory_records_user_scope_idx" ON "agent_memory_records"("user_id", "scope_type", "scope_id");
CREATE INDEX "agent_memory_records_user_kind_slot_idx" ON "agent_memory_records"("user_id", "memory_kind", "memory_slot");
CREATE INDEX "agent_memory_records_user_deleted_idx" ON "agent_memory_records"("user_id", "is_deleted");

ALTER TABLE "agent_memory_records"
ADD CONSTRAINT "agent_memory_records_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_memory_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "block_type" VARCHAR(20) NOT NULL,
    "scope_type" VARCHAR(20) NOT NULL,
    "scope_id" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "agent_memory_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_memory_blocks_user_id_idx" ON "agent_memory_blocks"("user_id");
CREATE UNIQUE INDEX "agent_memory_blocks_unique_scope_idx" ON "agent_memory_blocks"("user_id", "block_type", "scope_type", "scope_id");

ALTER TABLE "agent_memory_blocks"
ADD CONSTRAINT "agent_memory_blocks_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
