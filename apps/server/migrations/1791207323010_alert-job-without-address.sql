-- Up Migration

-- A job-alert email can name a job without any link the app can read (T20, user decision
-- 2026-10-05): Snaphunt's links all go through SendGrid's encrypted click tracker, and the app
-- never opens a tracker. Such a job has no address (url is null) and is known within its source
-- by its company, title and location, which the import writes as a hash into external_id; this
-- index makes a repeat email refresh the same row.

alter table alert_job alter column url drop not null;

create unique index alert_job_unaddressed on alert_job (source_id, external_id) where url is null;
