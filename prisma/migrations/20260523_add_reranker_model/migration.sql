-- Add reranker_model column to api_providers
ALTER TABLE "api_providers" ADD COLUMN IF NOT EXISTS "reranker_model" TEXT;