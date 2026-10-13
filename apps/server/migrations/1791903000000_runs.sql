-- Up Migration
create table run_preset (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null,
  next_at timestamptz
);
create table search_run (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid references run_preset (id),
  config jsonb not null,
  criteria jsonb not null,
  sources jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','paused','ready','failed')),
  message text not null default '',
  created_at timestamptz not null default now(),
  active_since timestamptz,
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0),
  requests integer not null default 0 check (requests >= 0),
  materials integer not null default 0 check (materials >= 0),
  submissions integer not null default 0 check (submissions >= 0),
  cost_usd numeric not null default 0 check (cost_usd >= 0)
);
create unique index search_run_one_active on search_run ((true)) where status in ('queued','running');
create trigger search_run_snapshot before update or delete on search_run
  for each row execute function forbid_rewrite('status','message','active_since','elapsed_ms','requests','materials','submissions','cost_usd');
create table run_job (
  run_id uuid not null references search_run (id),
  job_id uuid not null references job (id),
  title text not null,
  snapshot_id uuid references job_snapshot (id),
  primary key (run_id, job_id)
);
create table run_step (
  run_id uuid not null references search_run (id),
  key text not null,
  done boolean not null default false,
  material boolean not null default false,
  message text not null default '',
  primary key (run_id, key)
);
create table run_request (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references search_run (id),
  reserved_usd numeric not null check (reserved_usd >= 0),
  cost_usd numeric check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create trigger run_request_immutable before update or delete on run_request
  for each row execute function forbid_rewrite('cost_usd');
alter table fill_task add column run_id uuid references search_run (id);
alter table application add column run_id uuid references search_run (id);

-- A count is consumed in the very transaction that uses approval and creates the application.
create function charge_run_submission() returns trigger language plpgsql as $$
declare budget search_run;
begin
  if new.submit_approval_id is null then return new; end if;
  select f.run_id into new.run_id from submit_approval a join fill_task f on f.id = a.fill_task_id
    where a.id = new.submit_approval_id;
  if new.run_id is null then return new; end if;
  select * into budget from search_run where id = new.run_id for update;
  if budget.status not in ('running','ready') or
     budget.submissions >= (budget.config->>'submissionLimit')::integer then
    raise exception 'This run is stopped or has reached its submission limit.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from run_job where run_id = new.run_id and job_id = new.job_id) then
    raise exception 'This job is not in this run.' using errcode = 'P0001';
  end if;
  update search_run set submissions = submissions + 1 where id = new.run_id;
  return new;
end $$;
create trigger application_run_budget before insert on application for each row execute function charge_run_submission();
