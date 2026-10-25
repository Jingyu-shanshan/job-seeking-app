-- Up Migration
-- Research is independent of frozen preparation and can only be finished once.
create table company_research (
  id uuid primary key,
  application_id uuid not null references application (id),
  company text not null check (length(company) between 1 and 80),
  website text not null,
  topic text not null check (topic in ('products', 'news')),
  query text not null check (length(query) between 1 and 128),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  message text not null default 'Outcome unconfirmed. Check this version; do not automatically start another paid search.',
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  issues jsonb not null default '[]' check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'pending') = (finished_at is null))
);
create index company_research_application on company_research(application_id, created_at desc);
create trigger company_research_immutable before update or delete on company_research
  for each row execute function forbid_rewrite('status','message','sources','issues','finished_at');
create trigger company_research_finished_immutable before update on company_research
  for each row when (old.finished_at is not null) execute function forbid_rewrite();
