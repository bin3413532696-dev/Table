/*
  Warnings:

  - You are about to drop the column `error_message` on the `agent_runs` table. All the data in the column will be lost.
  - You are about to drop the column `finished_at` on the `agent_runs` table. All the data in the column will be lost.
  - You are about to drop the column `requires_confirmation` on the `agent_runs` table. All the data in the column will be lost.
  - You are about to drop the column `started_at` on the `agent_runs` table. All the data in the column will be lost.
  - You are about to drop the `checkpoint_blobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `checkpoint_migrations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `checkpoint_writes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `checkpoints` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_assertion_evidence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_assertions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_bases` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_document_entities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_documents` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_entities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_ontology_classes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_ontology_relations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_relations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `projection_outbox_events` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `session_id` on table `agent_runs` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "knowledge_assertion_evidence" DROP CONSTRAINT "knowledge_assertion_evidence_assertion_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_assertion_evidence" DROP CONSTRAINT "knowledge_assertion_evidence_document_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_assertion_evidence" DROP CONSTRAINT "knowledge_assertion_evidence_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_assertions" DROP CONSTRAINT "knowledge_assertions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_bases" DROP CONSTRAINT "knowledge_bases_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_document_entities" DROP CONSTRAINT "knowledge_document_entities_document_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_document_entities" DROP CONSTRAINT "knowledge_document_entities_entity_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_document_entities" DROP CONSTRAINT "knowledge_document_entities_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_entities" DROP CONSTRAINT "knowledge_entities_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_ontology_classes" DROP CONSTRAINT "knowledge_ontology_classes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_ontology_relations" DROP CONSTRAINT "knowledge_ontology_relations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_relations" DROP CONSTRAINT "knowledge_relations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "projection_outbox_events" DROP CONSTRAINT "projection_outbox_events_user_id_fkey";

-- DropIndex
DROP INDEX "agent_runs_user_status_idx";

-- AlterTable
ALTER TABLE "agent_runs" DROP COLUMN "error_message",
DROP COLUMN "finished_at",
DROP COLUMN "requires_confirmation",
DROP COLUMN "started_at",
ALTER COLUMN "session_id" SET NOT NULL;

-- DropTable
DROP TABLE "checkpoint_blobs";

-- DropTable
DROP TABLE "checkpoint_migrations";

-- DropTable
DROP TABLE "checkpoint_writes";

-- DropTable
DROP TABLE "checkpoints";

-- DropTable
DROP TABLE "knowledge_assertion_evidence";

-- DropTable
DROP TABLE "knowledge_assertions";

-- DropTable
DROP TABLE "knowledge_bases";

-- DropTable
DROP TABLE "knowledge_document_entities";

-- DropTable
DROP TABLE "knowledge_documents";

-- DropTable
DROP TABLE "knowledge_entities";

-- DropTable
DROP TABLE "knowledge_ontology_classes";

-- DropTable
DROP TABLE "knowledge_ontology_relations";

-- DropTable
DROP TABLE "knowledge_relations";

-- DropTable
DROP TABLE "projection_outbox_events";

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新会话',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_idx" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_updated_at_idx" ON "agent_sessions"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "agent_runs_user_id_idx" ON "agent_runs"("user_id");

-- CreateIndex
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs"("session_id");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "agent_runs_created_idx" RENAME TO "agent_runs_user_id_created_at_idx";

-- Remove deleted_at columns and indexes (schema cleanup)
ALTER TABLE "api_providers" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "finance_records" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "knowledge_notes" DROP COLUMN IF EXISTS "deleted_at";
DROP INDEX IF EXISTS "api_providers_user_id_deleted_at_idx";
DROP INDEX IF EXISTS "tasks_user_id_deleted_at_idx";
DROP INDEX IF EXISTS "finance_records_user_id_deleted_at_idx";
DROP INDEX IF EXISTS "knowledge_notes_user_id_deleted_at_idx";

-- Update foreign key constraints to CASCADE
ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_user_id_fkey";
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_settings" DROP CONSTRAINT IF EXISTS "user_settings_user_id_fkey";
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_providers" DROP CONSTRAINT IF EXISTS "api_providers_user_id_fkey";
ALTER TABLE "api_providers" ADD CONSTRAINT "api_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_user_id_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finance_records" DROP CONSTRAINT IF EXISTS "finance_records_user_id_fkey";
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_notes" DROP CONSTRAINT IF EXISTS "knowledge_notes_user_id_fkey";
ALTER TABLE "knowledge_notes" ADD CONSTRAINT "knowledge_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_preset_tags" DROP CONSTRAINT IF EXISTS "knowledge_preset_tags_user_id_fkey";
ALTER TABLE "knowledge_preset_tags" ADD CONSTRAINT "knowledge_preset_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_notes_deleted_at_idx') THEN
    ALTER INDEX "knowledge_notes_deleted_at_idx" RENAME TO "knowledge_notes_user_id_idx";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_notes_user_id_idx') THEN
    NULL;
  ELSE
    CREATE INDEX "knowledge_notes_user_id_idx" ON "knowledge_notes"("user_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_notes_user_updated_at_idx') THEN
    ALTER INDEX "knowledge_notes_user_updated_at_idx" RENAME TO "knowledge_notes_user_id_updated_at_idx";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_notes_user_id_updated_at_idx') THEN
    NULL;
  ELSE
    CREATE INDEX "knowledge_notes_user_id_updated_at_idx" ON "knowledge_notes"("user_id", "updated_at" DESC);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_preset_tags_user_name_uq') THEN
    ALTER INDEX "knowledge_preset_tags_user_name_uq" RENAME TO "knowledge_preset_tags_user_id_name_key";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_preset_tags_user_id_name_key') THEN
    NULL;
  ELSE
    CREATE UNIQUE INDEX "knowledge_preset_tags_user_id_name_key" ON "knowledge_preset_tags"("user_id", "name");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_preset_tags_user_sort_idx') THEN
    ALTER INDEX "knowledge_preset_tags_user_sort_idx" RENAME TO "knowledge_preset_tags_user_id_sort_order_idx";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_preset_tags_user_id_sort_order_idx') THEN
    NULL;
  ELSE
    CREATE INDEX "knowledge_preset_tags_user_id_sort_order_idx" ON "knowledge_preset_tags"("user_id", "sort_order");
  END IF;
END $$;