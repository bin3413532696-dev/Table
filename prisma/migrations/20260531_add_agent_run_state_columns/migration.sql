ALTER TABLE "agent_runs"
ADD COLUMN IF NOT EXISTS "messages_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "executed_tool_calls_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "pending_tool_calls_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "assistant_text_chunks_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "timeline_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "final_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "error_text" TEXT,
ADD COLUMN IF NOT EXISTS "iteration_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "requires_confirmation" BOOLEAN NOT NULL DEFAULT false;
