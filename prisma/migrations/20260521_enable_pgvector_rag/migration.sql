-- Migration: Enable pgvector extension and create RAG tables
-- Date: 2026-05-21

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- Knowledge Documents Table
-- =====================================================
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  source TEXT,
  file_type TEXT,
  file_size INT DEFAULT 0,
  status TEXT DEFAULT 'pending',
  tags_json JSONB DEFAULT '[]',
  content_hash TEXT,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Status constraint
ALTER TABLE knowledge_documents
ADD CONSTRAINT knowledge_documents_status_check
CHECK (status IN ('pending', 'processing', 'indexed', 'failed', 'deleted'));

-- =====================================================
-- Knowledge Chunks Table (with vector column)
-- =====================================================
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_index INT DEFAULT 0,
  start_pos INT DEFAULT 0,
  end_pos INT DEFAULT 0,
  embedding vector(1536),
  embedding_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- Knowledge Embedding Cache Table
-- =====================================================
CREATE TABLE knowledge_embedding_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- =====================================================
-- Knowledge Index Jobs Table
-- =====================================================
CREATE TABLE knowledge_index_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INT DEFAULT 0,
  error_json JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- Vector Indexes (HNSW for similarity search)
-- =====================================================
CREATE INDEX knowledge_chunks_embedding_idx
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WHERE embedding IS NOT NULL;

-- =====================================================
-- FTS Indexes
-- =====================================================
CREATE INDEX knowledge_chunks_fts_idx
ON knowledge_chunks
USING gin (to_tsvector('simple', content));

CREATE INDEX knowledge_documents_fts_idx
ON knowledge_documents
USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));

-- =====================================================
-- Unique Constraints
-- =====================================================
CREATE UNIQUE INDEX knowledge_embedding_cache_unique_idx
ON knowledge_embedding_cache (user_id, content_hash, embedding_model);

-- =====================================================
-- Auxiliary Indexes
-- =====================================================
CREATE INDEX knowledge_documents_user_idx ON knowledge_documents(user_id);
CREATE INDEX knowledge_documents_user_updated_idx ON knowledge_documents(user_id, updated_at DESC);
CREATE INDEX knowledge_documents_status_idx ON knowledge_documents(user_id, status);

CREATE INDEX knowledge_chunks_document_idx ON knowledge_chunks(document_id);
CREATE INDEX knowledge_chunks_user_idx ON knowledge_chunks(user_id);
CREATE INDEX knowledge_chunks_document_index_idx ON knowledge_chunks(document_id, chunk_index);

CREATE INDEX knowledge_embedding_cache_hash_idx ON knowledge_embedding_cache(content_hash);
CREATE INDEX knowledge_embedding_cache_expires_idx ON knowledge_embedding_cache(expires_at);

CREATE INDEX knowledge_index_jobs_user_status_idx ON knowledge_index_jobs(user_id, status);
CREATE INDEX knowledge_index_jobs_document_idx ON knowledge_index_jobs(document_id);

-- =====================================================
-- Update Trigger for updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_knowledge_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_documents_updated_at_trigger
BEFORE UPDATE ON knowledge_documents
FOR EACH ROW
EXECUTE FUNCTION update_knowledge_documents_updated_at();

CREATE OR REPLACE FUNCTION update_knowledge_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_chunks_updated_at_trigger
BEFORE UPDATE ON knowledge_chunks
FOR EACH ROW
EXECUTE FUNCTION update_knowledge_chunks_updated_at();