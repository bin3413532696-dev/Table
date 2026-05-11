-- Add full-text search indexes for knowledge_notes
CREATE INDEX IF NOT EXISTS idx_knowledge_notes_title_fts ON knowledge_notes USING gin (to_tsvector('simple', title));
CREATE INDEX IF NOT EXISTS idx_knowledge_notes_content_fts ON knowledge_notes USING gin (to_tsvector('simple', content));
