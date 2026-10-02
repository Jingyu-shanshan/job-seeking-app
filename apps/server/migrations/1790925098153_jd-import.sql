-- Up Migration

alter table job_snapshot
  add column catalog_id text not null check (catalog_id ~ '^[a-z0-9_]+$'),
  add column title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  add column company text check (char_length(company) <= 1000),
  add column location text not null default '' check (char_length(location) <= 5000),
  add column last_captured_at timestamptz not null default now(),
  alter column source_url set not null,
  add constraint job_snapshot_source_url_https
    check (source_url ~ '^https://' and char_length(source_url) <= 2000);

drop trigger job_snapshot_immutable on job_snapshot;
create trigger job_snapshot_immutable before update on job_snapshot
  for each row execute function forbid_rewrite('last_captured_at');

alter table job_requirement
  add column kind text not null check (kind in ('must', 'nice')),
  add column origin text not null check (origin in ('model', 'user')),
  add column removed_at timestamptz;

create trigger job_requirement_immutable before update or delete on job_requirement
  for each row execute function forbid_rewrite('removed_at');

create table model_call (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('job_summary')),
  job_snapshot_id uuid references job_snapshot (id),
  model text not null check (btrim(model) <> '' and char_length(model) <= 200),
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens between 0 and input_tokens),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  failure_reason text check (btrim(failure_reason) <> '' and char_length(failure_reason) <= 1000),
  check (num_nulls(input_tokens, cached_input_tokens, output_tokens, cost_usd) in (0, 4))
);

create trigger model_call_immutable before update or delete on model_call
  for each row execute function forbid_rewrite();

create table job_summary (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null unique references job_snapshot (id),
  model_call_id uuid not null unique references model_call (id),
  responsibilities jsonb not null check (jsonb_typeof(responsibilities) = 'array'),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  created_at timestamptz not null default now()
);

create trigger job_summary_immutable before update or delete on job_summary
  for each row execute function forbid_rewrite();
