-- Add content_tsvector column for BM25 search
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "content_tsvector" TSVECTOR;

-- Create function to update tsvector
CREATE OR REPLACE FUNCTION update_content_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW."content_tsvector" := to_tsvector('simple', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic tsvector update
DROP TRIGGER IF EXISTS "knowledge_chunks_tsvector_trigger" ON "knowledge_chunks";
CREATE TRIGGER "knowledge_chunks_tsvector_trigger"
BEFORE INSERT OR UPDATE ON "knowledge_chunks"
FOR EACH ROW EXECUTE FUNCTION update_content_tsvector();

-- Create GIN index (non-concurrent, runs inside transaction)
CREATE INDEX IF NOT EXISTS "knowledge_chunks_content_tsvector_idx"
ON "knowledge_chunks" USING GIN ("content_tsvector");