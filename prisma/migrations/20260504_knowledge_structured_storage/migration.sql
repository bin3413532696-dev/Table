create table knowledge_entities (
  id text primary key,
  user_id uuid not null references users(id),
  type_id text not null,
  title text not null,
  summary text not null default '',
  aliases_json jsonb not null default '[]'::jsonb,
  tags_json jsonb not null default '[]'::jsonb,
  attributes_json jsonb not null default '{}'::jsonb,
  source text null,
  confidence double precision null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index knowledge_entities_user_id_idx on knowledge_entities(user_id);
create index knowledge_entities_updated_at_idx on knowledge_entities(user_id, updated_at desc);

create table knowledge_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  subject_id text not null,
  predicate_id text not null,
  target_id text not null,
  source text null,
  confidence double precision null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint knowledge_relations_unique_edge unique (user_id, subject_id, predicate_id, target_id)
);

create index knowledge_relations_subject_idx on knowledge_relations(user_id, subject_id);
create index knowledge_relations_target_idx on knowledge_relations(user_id, target_id);

create table knowledge_documents (
  id text primary key,
  user_id uuid not null references users(id),
  title text not null,
  summary text not null default '',
  content text not null default '',
  tags_json jsonb not null default '[]'::jsonb,
  source text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index knowledge_documents_user_id_idx on knowledge_documents(user_id);
create index knowledge_documents_updated_at_idx on knowledge_documents(user_id, updated_at desc);

create table knowledge_document_entities (
  user_id uuid not null references users(id),
  document_id text not null references knowledge_documents(id) on delete cascade,
  entity_id text not null references knowledge_entities(id) on delete cascade,
  primary key (user_id, document_id, entity_id)
);

create index knowledge_document_entities_document_idx on knowledge_document_entities(user_id, document_id);
create index knowledge_document_entities_entity_idx on knowledge_document_entities(user_id, entity_id);

create table knowledge_assertions (
  id text primary key,
  user_id uuid not null references users(id),
  subject_id text not null,
  predicate_id text not null,
  object_id text null,
  scalar_value_json jsonb null,
  source text null,
  confidence double precision null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index knowledge_assertions_user_id_idx on knowledge_assertions(user_id);
create index knowledge_assertions_subject_idx on knowledge_assertions(user_id, subject_id);
create index knowledge_assertions_object_idx on knowledge_assertions(user_id, object_id);

create table knowledge_assertion_evidence (
  user_id uuid not null references users(id),
  assertion_id text not null references knowledge_assertions(id) on delete cascade,
  document_id text not null references knowledge_documents(id) on delete cascade,
  primary key (user_id, assertion_id, document_id)
);

create index knowledge_assertion_evidence_assertion_idx on knowledge_assertion_evidence(user_id, assertion_id);
create index knowledge_assertion_evidence_document_idx on knowledge_assertion_evidence(user_id, document_id);
