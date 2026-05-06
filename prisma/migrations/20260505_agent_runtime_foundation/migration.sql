create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  session_id uuid null,
  status text not null,
  input_text text not null,
  model text not null,
  requires_confirmation boolean not null default false,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint agent_runs_status_check check (
    status in ('pending', 'running', 'waiting_confirmation', 'completed', 'failed', 'cancelled')
  )
);

create index if not exists agent_runs_user_status_idx on agent_runs(user_id, status);
create index if not exists agent_runs_created_idx on agent_runs(user_id, created_at desc);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  run_id uuid not null references agent_runs(id) on delete cascade,
  role text not null,
  content text not null,
  sequence integer not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_messages_role_check check (
    role in ('system', 'user', 'assistant', 'tool')
  )
);

create index if not exists agent_messages_run_seq_idx on agent_messages(run_id, sequence);
create unique index if not exists agent_messages_run_seq_uq on agent_messages(run_id, sequence);
create index if not exists agent_messages_user_created_idx on agent_messages(user_id, created_at desc);

create table if not exists tool_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  run_id uuid not null references agent_runs(id) on delete cascade,
  tool_name text not null,
  arguments_json jsonb not null default '{}'::jsonb,
  status text not null,
  requires_confirmation boolean not null default false,
  confirmation_requested_at timestamptz null,
  confirmed_at timestamptz null,
  result_json jsonb null,
  error_message text null,
  sequence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_executions_status_check check (
    status in ('pending', 'waiting_confirmation', 'running', 'completed', 'failed', 'cancelled')
  )
);

create index if not exists tool_executions_run_seq_idx on tool_executions(run_id, sequence);
create index if not exists tool_executions_status_idx on tool_executions(status);
create index if not exists tool_executions_user_created_idx on tool_executions(user_id, created_at desc);

create table if not exists agent_run_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  run_id uuid not null references agent_runs(id) on delete cascade,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_run_state_snapshots_run_created_idx on agent_run_state_snapshots(run_id, created_at desc);
create index if not exists agent_run_state_snapshots_user_created_idx on agent_run_state_snapshots(user_id, created_at desc);
