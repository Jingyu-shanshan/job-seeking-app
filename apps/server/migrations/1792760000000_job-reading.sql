-- Up Migration
create table job_reading (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references job_snapshot(id),
  requested_url text not null check (requested_url ~ '^https://' and char_length(requested_url) <= 2000),
  resolved_url text not null check (resolved_url ~ '^https://' and char_length(resolved_url) <= 2000),
  method text not null check (method in ('greenhouse_board','ashby_board','company_page')),
  read_at timestamptz not null default now()
);
create index job_reading_snapshot on job_reading(job_snapshot_id,read_at desc,id desc);
create trigger job_reading_immutable before update or delete on job_reading
  for each row execute function forbid_rewrite();
