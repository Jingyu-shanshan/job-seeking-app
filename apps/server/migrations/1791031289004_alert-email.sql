-- Up Migration

-- Job-alert emails (T20). The user pastes an email's source or uploads it; the app never connects
-- to a mailbox and never requests the sites the emails come from. Only what identifies an email
-- and the jobs read from it are kept, not the email itself: alert emails carry the user's address
-- and links that can sign them in. Everything here was read from an email, which is untrusted.
-- Both tables belong to one job-alert source (a `source` row of an `email_alert` catalog entry)
-- and go when it is removed; the `job` rows stay, as with job_posting.

create table alert_email (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source (id) on delete cascade,
  -- The Message-ID header, or a hash of the message when it has none, so importing the same email
  -- again finds this row.
  message_key text not null unique check (char_length(message_key) between 1 and 1000),
  sender text not null check (char_length(sender) <= 320),
  subject text not null check (char_length(subject) <= 1000),
  -- The Date header; null when it is missing or unreadable.
  sent_at timestamptz,
  -- From the last import: the jobs read, and links to jobs whose entry could not be read.
  jobs integer not null check (jobs >= 0),
  unreadable integer not null check (unreadable >= 0),
  first_imported_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now()
);

create index alert_email_source_id on alert_email (source_id);

-- A job as alert emails of one source showed it, refreshed in place by each email that lists it.
-- A job that has only this row has no text until the user pastes or saves it, or a job board the
-- user reads lists it (rules/same-job.ts).
create table alert_job (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source (id) on delete cascade,
  job_id uuid not null references job (id),
  -- The job's page on its site, rebuilt from the job's id by the source's link rules, so it carries
  -- none of the email's tracking or sign-in parameters.
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  -- The site's id for the job.
  external_id text not null check (external_id <> '' and char_length(external_id) <= 200),
  title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  -- As the email names it; null when it does not say.
  company text check (char_length(company) <= 1000),
  -- As the email wrote it, '' when it gave none.
  location text not null check (char_length(location) <= 5000),
  -- Other text the email showed with the job, such as pay or a line of description.
  details text not null default '' check (char_length(details) <= 2000),
  -- The newest email that listed the job.
  alert_email_id uuid not null references alert_email (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, url)
);

create index alert_job_job_id on alert_job (job_id);
create index alert_job_url on alert_job (url);
create index alert_job_alert_email_id on alert_job (alert_email_id);
