-- Up Migration

-- Approving and submitting one job's application (T18). The user approves the form as the runner
-- last read it, filled and stopped before Submit. Just before pressing Submit the runner reads the
-- form again; only when the approval still holds does the app record the application (to verify)
-- and let the runner press Submit, once. The runner then watches for Greenhouse's confirmation
-- page and sends what it saw: the receipt. Any other end leaves the application to verify, and
-- the user says whether it went through. Nothing is retried.

alter table fill_task drop constraint fill_task_status_check;
alter table fill_task add constraint fill_task_status_check
  check (status in ('waiting', 'filling', 'paused', 'filled', 'approved', 'submitting',
    'submitted', 'to_verify', 'closed', 'failed'));
alter table fill_task drop constraint fill_task_check;
alter table fill_task add constraint fill_task_runner_check
  check (status in ('waiting', 'closed', 'failed') or runner_token_id is not null);

drop index fill_task_open;
create unique index fill_task_open on fill_task (job_id)
  where status in ('waiting', 'filling', 'paused', 'filled', 'approved', 'submitting');

-- An approval names the look it approves, which must be one of its fill's.
alter table fill_check add constraint fill_check_id_task unique (id, fill_task_id);

-- The user's approval of one fill: the look at the form they saw (its values and screenshot), the
-- job text then current, and through the fill the answers and the kept PDFs (immutable, with their
-- SHA-256). It is used by at most one submission, or withdrawn; nothing else of it changes.
create table submit_approval (
  id uuid primary key default gen_random_uuid(),
  fill_task_id uuid not null references fill_task (id),
  fill_check_id uuid not null,
  job_snapshot_id uuid not null references job_snapshot (id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  withdrawn_at timestamptz,
  foreign key (fill_check_id, fill_task_id) references fill_check (id, fill_task_id),
  check (used_at is null or withdrawn_at is null)
);

-- A fill has at most one approval that can still be used.
create unique index submit_approval_live on submit_approval (fill_task_id)
  where used_at is null and withdrawn_at is null;

create trigger submit_approval_immutable before update or delete on submit_approval
  for each row execute function forbid_rewrite('used_at', 'withdrawn_at');

-- An application now names its job and the approval it used: one approval, one submission. A job
-- has at most one application that went in or may have gone in. `not_submitted` is one the user
-- found did not go through.
alter table application add column job_id uuid references job (id);
update application a set job_id = s.job_id from job_snapshot s where s.id = a.job_snapshot_id;
alter table application alter column job_id set not null;
alter table application add column submit_approval_id uuid unique references submit_approval (id);
alter table application drop constraint application_status_check;
alter table application add constraint application_status_check
  check (status in ('to_verify', 'submitted', 'not_submitted'));

create unique index application_job_open on application (job_id)
  where status in ('to_verify', 'submitted');
create index application_created on application (created_at);

create trigger application_immutable before update or delete on application
  for each row execute function forbid_rewrite('status', 'submitted_at');

-- What the runner saw after it pressed Submit: whether it was Greenhouse's confirmation page for
-- the job, the page's address and words, and a PNG (none when the window was gone).
create table submit_receipt (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references application (id),
  confirmed boolean not null,
  page_url text check (char_length(page_url) <= 2000),
  page_text text not null check (char_length(page_text) <= 20000),
  note text not null check (char_length(note) <= 1000),
  screenshot bytea check (octet_length(screenshot) between 8 and 8388608),
  created_at timestamptz not null default now()
);

create trigger submit_receipt_immutable before update or delete on submit_receipt
  for each row execute function forbid_rewrite();
