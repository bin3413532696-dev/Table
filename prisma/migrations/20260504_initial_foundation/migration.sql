create extension if not exists "pgcrypto";

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check check (status in ('active', 'disabled'))
);

create table user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  theme text not null default 'light',
  profile_json jsonb not null default '{}'::jsonb,
  notification_json jsonb not null default '{}'::jsonb,
  security_pin_hash text null,
  agent_preferences_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint user_settings_theme_check check (theme in ('light', 'dark', 'system'))
);

create table api_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  api_format text not null,
  base_url text not null,
  api_key_encrypted text null,
  model text null,
  headers_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  constraint api_providers_api_format_check check (api_format in ('openai', 'anthropic', 'gemini', 'custom'))
);

create index api_providers_user_id_idx on api_providers(user_id);
create index api_providers_active_idx on api_providers(user_id, is_active) where deleted_at is null;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  completed boolean not null default false,
  priority text not null default 'medium',
  due_date date null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  constraint tasks_title_check check (char_length(trim(title)) > 0),
  constraint tasks_priority_check check (priority in ('low', 'medium', 'high'))
);

create index tasks_user_id_idx on tasks(user_id) where deleted_at is null;
create index tasks_user_completed_idx on tasks(user_id, completed) where deleted_at is null;
create index tasks_user_priority_idx on tasks(user_id, priority) where deleted_at is null;
create index tasks_due_date_idx on tasks(user_id, due_date) where deleted_at is null and due_date is not null;
create index tasks_updated_at_idx on tasks(user_id, updated_at desc) where deleted_at is null;

create table finance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null,
  amount numeric(18,2) not null,
  category text not null,
  description text not null,
  record_date date not null,
  model text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  constraint finance_records_type_check check (type in ('income', 'expense')),
  constraint finance_records_amount_check check (amount >= 0),
  constraint finance_records_category_check check (char_length(trim(category)) > 0),
  constraint finance_records_description_check check (char_length(trim(description)) > 0)
);

create index finance_records_user_id_idx on finance_records(user_id) where deleted_at is null;
create index finance_records_user_type_idx on finance_records(user_id, type) where deleted_at is null;
create index finance_records_user_category_idx on finance_records(user_id, category) where deleted_at is null;
create index finance_records_user_record_date_idx on finance_records(user_id, record_date desc) where deleted_at is null;
create index finance_records_updated_at_idx on finance_records(user_id, updated_at desc) where deleted_at is null;
