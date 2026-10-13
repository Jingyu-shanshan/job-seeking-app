-- Up Migration

alter table model_call drop constraint model_call_purpose_check;
alter table model_call add constraint model_call_purpose_check
  check (purpose in ('job_summary', 'match', 'draft', 'interview'));

-- One preparation of the actual sent version; sources keep exactly what the provider received.
create table interview_preparation (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references application (id),
  model_call_id uuid not null unique references model_call (id),
  sources jsonb not null check (jsonb_typeof(sources) = 'array'),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  created_at timestamptz not null default now()
);
create trigger interview_preparation_immutable before update or delete on interview_preparation
  for each row execute function forbid_rewrite();

-- Private practice notes: no confirmation and no link that can promote them to facts.
create table interview_notes (
  preparation_id uuid primary key references interview_preparation (id),
  body text not null check (char_length(body) <= 12000)
);
