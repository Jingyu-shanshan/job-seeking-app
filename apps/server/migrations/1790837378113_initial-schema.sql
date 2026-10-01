-- Up Migration

-- Minimal tables for facts, job descriptions, matches, materials and applications (T02).
-- Columns whose vocabulary a later task decides (fact kinds, requirement kinds, match reasons,
-- rendered files, approvals, sources) are added by that task's own migration.
-- No down migration: production never runs destructive downs.

-- Content hash: lowercase hex SHA-256 of the UTF-8 bytes of `body`, computed here so that no
-- caller can store a hash that does not match the text. (convert_to is only STABLE, so this
-- cannot be a generated column.)
create function set_body_sha256() returns trigger
language plpgsql as $$
begin
  new.body_sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  return new;
end;
$$;

-- Rejects DELETE, and UPDATE of any column not named in the trigger arguments. Columns added
-- later are therefore immutable unless their migration adds them to the list.
create function forbid_rewrite() returns trigger
language plpgsql as $$
declare
  mutable text[] := coalesce(tg_argv, '{}');
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted', tg_table_name;
  end if;
  if to_jsonb(new) - mutable is distinct from to_jsonb(old) - mutable then
    raise exception '% row % is immutable%', tg_table_name, old.id,
      case when cardinality(mutable) > 0 then ' except for ' || array_to_string(mutable, ', ') else '' end;
  end if;
  return new;
end;
$$;

-- Facts: a stable identity plus append-only versions. Confirmation and visibility belong to a
-- version; editing the text means adding a new (proposed) version.

create table fact (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table fact_version (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references fact (id),
  version integer not null check (version > 0),
  body text not null check (btrim(body) <> ''),
  body_sha256 text not null,
  source text not null check (btrim(source) <> ''),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'retired')),
  may_send_to_model boolean not null default false,
  may_use_in_materials boolean not null default false,
  created_at timestamptz not null default now(),
  unique (fact_id, version)
);

create trigger fact_version_hash before insert on fact_version
  for each row execute function set_body_sha256();
create trigger fact_version_append_only before update or delete on fact_version
  for each row execute function forbid_rewrite('status', 'may_send_to_model', 'may_use_in_materials');

-- Job descriptions: a job is the stable identity, a snapshot is one captured raw text.
-- Snapshots are never updated; capturing the same text again for a job is a no-op via the
-- unique hash. An unreferenced snapshot may be deleted.

create table job (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table job_snapshot (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job (id),
  body text not null check (btrim(body) <> '' and octet_length(body) <= 1048576),
  body_sha256 text not null,
  source_url text,
  captured_at timestamptz not null default now(),
  unique (job_id, body_sha256)
);

create trigger job_snapshot_hash before insert on job_snapshot
  for each row execute function set_body_sha256();
create trigger job_snapshot_immutable before update on job_snapshot
  for each row execute function forbid_rewrite();

-- A requirement extracted from one snapshot. `quote` is the JD span the model gave;
-- `quote_verified` is the result of the substring check. Unverified requirements are
-- to-confirm and stay out of hard-requirement evaluation.
create table job_requirement (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references job_snapshot (id),
  body text not null check (btrim(body) <> ''),
  quote text not null,
  quote_verified boolean not null,
  created_at timestamptz not null default now()
);

-- Matches: a verdict for one snapshot, an outcome per requirement, and the fact versions that
-- support each outcome.

create table match (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references job_snapshot (id),
  verdict text not null check (verdict in ('eligible', 'to_confirm', 'ineligible')),
  created_at timestamptz not null default now()
);

create table match_requirement (
  match_id uuid not null references match (id),
  job_requirement_id uuid not null references job_requirement (id),
  outcome text not null check (outcome in ('met', 'unmet', 'unknown')),
  primary key (match_id, job_requirement_id)
);

create table match_evidence (
  match_id uuid not null,
  job_requirement_id uuid not null,
  fact_version_id uuid not null references fact_version (id),
  primary key (match_id, job_requirement_id, fact_version_id),
  foreign key (match_id, job_requirement_id) references match_requirement (match_id, job_requirement_id)
);

-- Materials: a generated document for one snapshot, made of ordered claims. Each claim cites
-- fact versions by foreign key; the fact text is never copied.

create table artifact (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references job_snapshot (id),
  kind text not null check (kind in ('resume', 'cover_letter')),
  created_at timestamptz not null default now()
);

create table artifact_claim (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifact (id),
  position integer not null check (position >= 0),
  body text not null check (btrim(body) <> ''),
  unique (artifact_id, position)
);

create table artifact_claim_fact (
  artifact_claim_id uuid not null references artifact_claim (id),
  fact_version_id uuid not null references fact_version (id),
  primary key (artifact_claim_id, fact_version_id)
);

-- Applications: exist only once something was submitted. `to_verify` is a submission whose
-- result is unknown; it has no submission time until the user verifies it. The application
-- references the snapshot, the materials and the fact versions it was built from.

create table application (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references job_snapshot (id),
  status text not null check (status in ('to_verify', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'submitted') = (submitted_at is not null))
);

create table application_artifact (
  application_id uuid not null references application (id),
  artifact_id uuid not null references artifact (id),
  primary key (application_id, artifact_id)
);

create table application_fact_version (
  application_id uuid not null references application (id),
  fact_version_id uuid not null references fact_version (id),
  primary key (application_id, fact_version_id)
);
