-- Up Migration

-- The application record (T09). When an application is recorded, what it was built from is frozen
-- with it: the job text (already `job_snapshot_id`), the match of that text then latest, the files
-- that went out and the fact versions their statements cite. The runner's form values and its
-- receipt are frozen through the approval (T18). An application sent outside the app is recorded
-- by the user, with the time they sent it and the files they say went out. Later changes to facts,
-- drafts or answers change none of it.

-- How it went in: the runner pressed Submit after the user's approval, or the user applied outside
-- the app and recorded it, which counts as submitted from the start.
alter table application add column method text not null default 'runner'
  check (method in ('runner', 'manual'));
alter table application alter column method drop default;
alter table application add constraint application_manual_unapproved
  check (method = 'runner' or submit_approval_id is null);
alter table application add constraint application_manual_submitted
  check (method = 'runner' or (status = 'submitted' and submitted_at <= created_at));

-- The user's words about an application recorded by hand, such as where they sent it.
alter table application add column note text not null default ''
  check (char_length(note) <= 1000);

-- The match of the frozen text that was latest when the application was recorded, if any.
alter table match add constraint match_id_snapshot unique (id, job_snapshot_id);
alter table application add column match_id uuid;
alter table application add constraint application_match
  foreign key (match_id, job_snapshot_id) references match (id, job_snapshot_id);

-- A file that went out with the application: a PDF the app kept of a draft (T08), or a file the
-- user uploaded when recording an application sent outside the app (the version actually sent).
-- Either way it has a size cap and a SHA-256 computed by the database.
create table application_file (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references application (id),
  position integer not null check (position >= 0),
  -- The form's question for the runner's files, e.g. "Resume/CV"; '' for files recorded by hand.
  label text not null check (char_length(label) <= 1000),
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  document_pdf_id uuid references document_pdf (id),
  body bytea check (octet_length(body) between 1 and 2097152),
  body_sha256 text not null,
  created_at timestamptz not null default now(),
  check ((document_pdf_id is null) <> (body is null)),
  unique (application_id, position),
  unique (application_id, body_sha256)
);

create function set_application_file_sha256() returns trigger
language plpgsql as $$
begin
  if new.body is null then
    select body_sha256 into new.body_sha256 from document_pdf where id = new.document_pdf_id;
  else
    new.body_sha256 := encode(sha256(new.body), 'hex');
  end if;
  return new;
end;
$$;

create trigger application_file_sha256 before insert on application_file
  for each row execute function set_application_file_sha256();

create trigger application_file_immutable before update or delete on application_file
  for each row execute function forbid_rewrite();
create trigger application_artifact_immutable before update or delete on application_artifact
  for each row execute function forbid_change();
create trigger application_fact_version_immutable before update or delete on application_fact_version
  for each row execute function forbid_change();
