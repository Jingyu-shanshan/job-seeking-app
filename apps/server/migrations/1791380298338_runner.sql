-- Up Migration

-- The local runner (T17): a process on the user's computer that fills a job's application form
-- in a visible browser window and stops before Submit. It signs in with a token the user issued in
-- the app, of which only the SHA-256 is kept. The user starts each fill for one job; the fill
-- keeps the answers as the user saw them then, and the runner sends back what the form holds, with
-- a screenshot, each look kept unchanged. Nothing here submits an application (T18).

create table runner_token (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 100),
  token_sha256 bytea not null unique check (octet_length(token_sha256) = 32),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create trigger runner_token_immutable before update or delete on runner_token
  for each row execute function forbid_rewrite('last_used_at', 'revoked_at');

-- One fill of one job's form: the page the runner opens, and every question of the form the app
-- read (`job_form_id`) with what the runner puts in (rules/fill.ts). Only the status and what the
-- runner did change. A job has at most one fill that is not closed or failed.
create table fill_task (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job (id),
  job_form_id uuid not null references job_form (id),
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  fields jsonb not null check (jsonb_typeof(fields) = 'array' and octet_length(fields::text) <= 2097152),
  status text not null default 'waiting'
    check (status in ('waiting', 'filling', 'paused', 'filled', 'closed', 'failed')),
  message text not null default '' check (char_length(message) <= 4000),
  -- The runner that took it.
  runner_token_id uuid references runner_token (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  runner_seen_at timestamptz,
  check (status not in ('filling', 'paused', 'filled') or runner_token_id is not null)
);

create unique index fill_task_open on fill_task (job_id)
  where status in ('waiting', 'filling', 'paused', 'filled');
create index fill_task_job on fill_task (job_id, created_at);
create index fill_task_waiting on fill_task (created_at) where status = 'waiting';

create trigger fill_task_immutable before update or delete on fill_task
  for each row execute function forbid_rewrite('status', 'message', 'runner_token_id', 'updated_at', 'runner_seen_at');

-- One look of the runner at the form, after it filled it or after the user's Continue: what each
-- field of the page held (`fields`, as the runner read them) and a PNG of the form. What each field
-- holds compared with the fill's answers is computed when it is read (rules/fill.ts).
create table fill_check (
  id uuid primary key default gen_random_uuid(),
  fill_task_id uuid not null references fill_task (id),
  filled_now boolean not null,
  blocker text check (blocker in ('captcha', 'login')),
  fields jsonb not null check (jsonb_typeof(fields) = 'array' and octet_length(fields::text) <= 4194304),
  screenshot bytea not null check (octet_length(screenshot) between 8 and 8388608),
  -- clock_timestamp: two looks never tie, so the latest is always one row.
  created_at timestamptz not null default clock_timestamp()
);

create index fill_check_task on fill_check (fill_task_id, created_at);

create trigger fill_check_immutable before update or delete on fill_check
  for each row execute function forbid_rewrite();
