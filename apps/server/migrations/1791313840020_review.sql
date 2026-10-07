-- Up Migration

-- Review and PDF (T08). The user's details go into the documents' header, written by the app and
-- never sent to DeepSeek. The user's changes to a draft are added next to DeepSeek's statements,
-- never over them. A PDF the user printed is kept only when its text is the document's text; it
-- keeps that text and the statement versions it was built from, so it can be traced later.

-- One row, like job_criteria. Only filled fields appear on documents; T16 reuses them in forms.
create table profile (
  singleton boolean primary key default true check (singleton),
  name text not null default '' check (char_length(name) <= 100),
  email text not null default '' check (char_length(email) <= 200),
  phone text not null default '' check (char_length(phone) <= 40),
  location text not null default '' check (char_length(location) <= 100),
  links text[] not null default '{}' check (cardinality(links) <= 3),
  updated_at timestamptz not null default now()
);

insert into profile default values;

-- The user's version of a statement: its text and whether it goes into the document. The latest
-- row wins; a statement without a row is DeepSeek's text, in the document if its checks pass.
-- The text is checked like DeepSeek's (rules/statement.ts), against the same cited facts or quote.
create table artifact_claim_edit (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  artifact_claim_id uuid not null,
  body text not null check (btrim(body) <> '' and char_length(body) <= 2000),
  included boolean not null,
  -- clock_timestamp: two edits never tie, so the latest is always one row.
  created_at timestamptz not null default clock_timestamp(),
  foreign key (artifact_claim_id, artifact_id) references artifact_claim (id, artifact_id),
  unique (id, artifact_claim_id)
);

create index artifact_claim_edit_claim on artifact_claim_edit (artifact_claim_id, created_at);

-- A PDF of a draft, uploaded by the user and kept because its text was the document's text at
-- the time, which `text` holds (one piece per line, as rules/document.ts lists them).
create table document_pdf (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifact (id),
  body bytea not null check (octet_length(body) between 1 and 2097152),
  body_sha256 text not null,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  pages integer not null check (pages between 1 and 20),
  text text not null check (btrim(text) <> ''),
  created_at timestamptz not null default now(),
  unique (artifact_id, body_sha256),
  unique (id, artifact_id)
);

create function set_file_sha256() returns trigger
language plpgsql as $$
begin
  new.body_sha256 := encode(sha256(new.body), 'hex');
  return new;
end;
$$;

create trigger document_pdf_sha256 before insert on document_pdf
  for each row execute function set_file_sha256();

-- The statements in a kept PDF, each with the user's version it used (none: DeepSeek's text).
create table document_pdf_statement (
  document_pdf_id uuid not null,
  artifact_id uuid not null,
  artifact_claim_id uuid not null,
  artifact_claim_edit_id uuid,
  primary key (document_pdf_id, artifact_claim_id),
  foreign key (document_pdf_id, artifact_id) references document_pdf (id, artifact_id),
  foreign key (artifact_claim_id, artifact_id) references artifact_claim (id, artifact_id),
  foreign key (artifact_claim_edit_id, artifact_claim_id)
    references artifact_claim_edit (id, artifact_claim_id)
);

create trigger artifact_claim_edit_immutable before update or delete on artifact_claim_edit
  for each row execute function forbid_rewrite();
create trigger document_pdf_immutable before update or delete on document_pdf
  for each row execute function forbid_rewrite();
create trigger document_pdf_statement_immutable before update or delete on document_pdf_statement
  for each row execute function forbid_change();
