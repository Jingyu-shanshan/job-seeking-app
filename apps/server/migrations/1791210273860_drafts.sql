-- Up Migration

-- Drafts (T07): DeepSeek writes a resume or a cover letter for one job text as statements. A
-- statement about the job seeker cites the fact versions it rests on, one about the job quotes the
-- job text, and a connecting sentence of a cover letter cites nothing. Which statements may go
-- into the document is decided when a draft is read (rules/statement.ts) and never stored, so a
-- fact that changes later takes its statements out at once. Nothing here changes afterwards:
-- writing again adds a new artifact.

alter table model_call drop constraint model_call_purpose_check;
alter table model_call add constraint model_call_purpose_check
  check (purpose in ('job_summary', 'match', 'draft'));

alter table artifact add column model_call_id uuid not null unique references model_call (id);
create index artifact_job_snapshot_id on artifact (job_snapshot_id, kind, created_at);

-- The fact versions sent with the request, exactly. Statements can cite only these, and a later
-- change to the facts shows as a difference from this list.
create table artifact_fact (
  artifact_id uuid not null references artifact (id),
  fact_version_id uuid not null references fact_version (id),
  primary key (artifact_id, fact_version_id)
);

-- `section`, `block` and `line` place a statement: a resume entry's title line or a bullet under
-- it (block is the entry), a sentence of the headline or summary, or a sentence of a cover letter
-- paragraph (block is the paragraph). Every resume statement is about the job seeker.
alter table artifact_claim
  add column section text not null check (
    section in ('headline', 'summary', 'experience', 'projects', 'skills', 'education',
      'languages', 'certifications', 'letter')
  ),
  add column block integer not null check (block >= 0),
  add column line text not null check (line in ('title', 'bullet', 'sentence')),
  add column about text not null check (about in ('me', 'job', 'other')),
  -- The job-text passage a statement about the job rests on, as DeepSeek gave it.
  add column quote text check (char_length(quote) <= 2000),
  -- Fact refs DeepSeek cited that were not in the request; the statement cannot pass.
  add column unsent_refs text[] not null default '{}' check (cardinality(unsent_refs) <= 50),
  add constraint artifact_claim_body_length check (char_length(body) <= 2000),
  add constraint artifact_claim_placement check (
    (section in ('headline', 'summary', 'letter')) = (line = 'sentence')
  ),
  add constraint artifact_claim_resume_about check (section = 'letter' or about = 'me'),
  add constraint artifact_claim_quote_about check (quote is null or about = 'job'),
  add constraint artifact_claim_id_artifact unique (id, artifact_id);

alter table artifact_claim_fact
  add column artifact_id uuid not null,
  add constraint artifact_claim_fact_claim
    foreign key (artifact_claim_id, artifact_id) references artifact_claim (id, artifact_id),
  add constraint artifact_claim_fact_sent_fact
    foreign key (artifact_id, fact_version_id) references artifact_fact (artifact_id, fact_version_id);

create trigger artifact_immutable before update or delete on artifact
  for each row execute function forbid_rewrite();
create trigger artifact_claim_immutable before update or delete on artifact_claim
  for each row execute function forbid_rewrite();
create trigger artifact_claim_fact_immutable before update or delete on artifact_claim_fact
  for each row execute function forbid_change();
create trigger artifact_fact_immutable before update or delete on artifact_fact
  for each row execute function forbid_change();
