-- Create knowledge_notes table for personal knowledge management
create table knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  content text not null default '',
  tags_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint knowledge_notes_title_check check (char_length(trim(title)) > 0)
);

create index knowledge_notes_user_id_idx on knowledge_notes(user_id);
create index knowledge_notes_user_updated_at_idx on knowledge_notes(user_id, updated_at desc);
create index knowledge_notes_deleted_at_idx on knowledge_notes(user_id, deleted_at);

-- Create knowledge_preset_tags table for predefined tag colors
create table knowledge_preset_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  color text not null default '#6B7280',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_preset_tags_name_check check (char_length(trim(name)) > 0)
);

create unique index knowledge_preset_tags_user_name_uq on knowledge_preset_tags(user_id, name);
create index knowledge_preset_tags_user_sort_idx on knowledge_preset_tags(user_id, sort_order);