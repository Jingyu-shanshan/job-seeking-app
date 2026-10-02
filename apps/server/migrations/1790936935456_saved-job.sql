-- Up Migration

-- Jobs the user saved from a page in the desktop app (T21): the job page they were looking at, or
-- an entry a results page showed. One row per page address (rules/job-page.ts gives every address
-- of one LinkedIn job the same one), refreshed in place by each save with what the page showed.
-- A job saved from a results page has only this row until its text is saved or pasted; the text
-- itself goes into job_snapshot, never here.
-- Nothing here comes from the third-party site's session: no cookies, no account details.

create table saved_job (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job (id),
  url text not null unique check (url ~ '^https://' and char_length(url) <= 2000),
  title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  -- As the page names it; null when it does not say.
  company text check (char_length(company) <= 1000),
  -- As the page wrote it, '' when it gave none.
  location text not null check (char_length(location) <= 5000),
  first_saved_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now()
);

create index saved_job_job_id on saved_job (job_id);
