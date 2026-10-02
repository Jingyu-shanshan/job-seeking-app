-- Up Migration

-- Jobs found by discovery runs (T13). A posting is one job as one of the user's sources lists it,
-- as of the last run that read that source; runs update it in place. It is not a JD snapshot:
-- raw job text goes into job_snapshot (T05), which is never updated.
-- The same posting found through two sources of one catalog entry (e.g. a board added twice in
-- different letter case) is one job: both postings point at the same `job` row.
-- Removing a source removes its postings; the `job` rows and anything attached to them stay.

create table job_posting (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source (id) on delete cascade,
  job_id uuid not null references job (id),
  -- The source's own id for the posting, e.g. a Greenhouse job post id.
  external_id text not null check (external_id <> '' and char_length(external_id) <= 200),
  title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  -- As the source names it; null when it does not say.
  company text check (char_length(company) <= 1000),
  -- As the source wrote it, '' when it gave none; several locations are separated by ';'.
  location text not null check (char_length(location) <= 5000),
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  -- When the source first published the job, if it says.
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a successful run of the source no longer lists the posting, cleared if it returns.
  -- A failed run changes nothing here.
  closed_at timestamptz,
  unique (source_id, external_id)
);
