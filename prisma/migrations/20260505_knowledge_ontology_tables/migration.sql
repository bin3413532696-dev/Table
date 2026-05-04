CREATE TABLE "knowledge_ontology_classes" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "parent_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "knowledge_ontology_classes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_ontology_relations" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "symmetric" BOOLEAN NOT NULL DEFAULT false,
  "transitive" BOOLEAN NOT NULL DEFAULT false,
  "inverse_of" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "knowledge_ontology_relations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_ontology_classes_user_id_idx"
ON "knowledge_ontology_classes"("user_id");

CREATE INDEX "knowledge_ontology_classes_user_id_updated_at_idx"
ON "knowledge_ontology_classes"("user_id", "updated_at" DESC);

CREATE INDEX "knowledge_ontology_relations_user_id_idx"
ON "knowledge_ontology_relations"("user_id");

CREATE INDEX "knowledge_ontology_relations_user_id_updated_at_idx"
ON "knowledge_ontology_relations"("user_id", "updated_at" DESC);

ALTER TABLE "knowledge_ontology_classes"
ADD CONSTRAINT "knowledge_ontology_classes_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "knowledge_ontology_relations"
ADD CONSTRAINT "knowledge_ontology_relations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
