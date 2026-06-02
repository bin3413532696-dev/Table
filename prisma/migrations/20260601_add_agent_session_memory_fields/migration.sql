ALTER TABLE "agent_sessions"
ADD COLUMN "memory_summary" TEXT NOT NULL DEFAULT '',
ADD COLUMN "memory_preferences_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "memory_facts_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "memory_goals_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "memory_todos_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "memory_rules_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "memory_status" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "memory_updated_at" TIMESTAMPTZ,
ADD COLUMN "memory_disabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "memory_run_count" INTEGER NOT NULL DEFAULT 0;
