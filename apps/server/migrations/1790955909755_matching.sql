-- Up Migration

-- Criteria and evidence matching (T06).

-- The user's criteria. The single row of search_scope becomes job_criteria: the search scope is
-- the location criterion's value. Each criterion is hard (it decides whether a job is eligible),
-- a preference (only shown) or off. A criterion the job may not state also says what an unknown
-- does when it is hard: the job goes to to-confirm, or it is ruled out for lack of information.
-- An unknown never counts as met. Criteria are applied when jobs are read (rules/criteria.ts) and
-- never stored per job, so a change applies at once.

create domain criterion_strength as text check (value in ('hard', 'preference', 'off'));
create domain if_unknown as text check (value in ('to_confirm', 'rule_out'));

alter table search_scope rename to job_criteria;

alter table job_criteria
  add column location_strength criterion_strength not null default 'hard',
  add column location_if_unknown if_unknown not null default 'to_confirm',
  -- Words the title should have, any of them.
  add column title_strength criterion_strength not null default 'off',
  add column title_words text[] not null default '{}',
  -- Words the title should not have.
  add column avoid_strength criterion_strength not null default 'off',
  add column avoid_words text[] not null default '{}',
  -- Languages the user can work in, compared with the summary's working languages.
  add column language_strength criterion_strength not null default 'off',
  add column language_if_unknown if_unknown not null default 'to_confirm',
  add column languages text[] not null default '{}',
  -- Employment types the user accepts, compared with the summary's employment type.
  add column employment_strength criterion_strength not null default 'off',
  add column employment_if_unknown if_unknown not null default 'to_confirm',
  add column employment_types text[] not null default '{}' check (
    employment_types <@ array['full_time', 'part_time', 'permanent', 'fixed_term', 'contract', 'internship']
  ),
  -- Whether the user's facts meet the job's must-haves, from the latest evidence match.
  add column must_have_strength criterion_strength not null default 'preference',
  add column must_have_if_unknown if_unknown not null default 'to_confirm',
  add constraint job_criteria_list_sizes check (
    cardinality(title_words) <= 50 and cardinality(avoid_words) <= 50 and cardinality(languages) <= 50
  ),
  -- A criterion in use has something to compare with.
  add constraint job_criteria_values_given check (
    (title_strength = 'off' or cardinality(title_words) > 0)
    and (avoid_strength = 'off' or cardinality(avoid_words) > 0)
    and (language_strength = 'off' or cardinality(languages) > 0)
    and (employment_strength = 'off' or cardinality(employment_types) > 0)
  );

-- Evidence matching: one DeepSeek comparison of a snapshot's requirements with the facts the user
-- allowed to be sent. Nothing in it changes afterwards; matching again adds a new match.

alter table model_call drop constraint model_call_purpose_check;
alter table model_call add constraint model_call_purpose_check
  check (purpose in ('job_summary', 'match'));

-- `verdict` is whether the facts met the snapshot's verified must-haves when it was matched:
-- eligible when all were met, ineligible when one was not, to_confirm otherwise.
alter table match add column model_call_id uuid not null unique references model_call (id);
create index match_job_snapshot_id on match (job_snapshot_id, created_at);

-- DeepSeek's one-sentence explanation of the outcome. Untrusted text, shown as is.
alter table match_requirement add column note text not null check (char_length(note) <= 1000);

-- The fact versions sent with the request, exactly. Evidence can cite only these, and a later
-- change to the facts shows as a difference from this list.
create table match_fact (
  match_id uuid not null references match (id),
  fact_version_id uuid not null references fact_version (id),
  primary key (match_id, fact_version_id)
);

alter table match_evidence add constraint match_evidence_sent_fact
  foreign key (match_id, fact_version_id) references match_fact (match_id, fact_version_id);

-- For tables without an id column, which forbid_rewrite names in its message.
create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be changed or deleted', tg_table_name;
end;
$$;

create trigger match_immutable before update or delete on match
  for each row execute function forbid_rewrite();
create trigger match_requirement_immutable before update or delete on match_requirement
  for each row execute function forbid_change();
create trigger match_evidence_immutable before update or delete on match_evidence
  for each row execute function forbid_change();
create trigger match_fact_immutable before update or delete on match_fact
  for each row execute function forbid_change();
