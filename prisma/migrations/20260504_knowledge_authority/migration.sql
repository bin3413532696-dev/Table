create table knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  dataset_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index knowledge_bases_updated_at_idx on knowledge_bases(user_id, updated_at desc);
