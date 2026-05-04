CREATE TABLE "projection_outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "topic" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "projection_outbox_events_status_available_at_idx"
ON "projection_outbox_events"("status", "available_at" ASC);

CREATE INDEX "projection_outbox_events_user_id_status_available_at_idx"
ON "projection_outbox_events"("user_id", "status", "available_at" ASC);

CREATE INDEX "projection_outbox_events_user_id_topic_status_idx"
ON "projection_outbox_events"("user_id", "topic", "status");

ALTER TABLE "projection_outbox_events"
ADD CONSTRAINT "projection_outbox_events_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
