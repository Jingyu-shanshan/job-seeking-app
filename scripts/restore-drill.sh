#!/usr/bin/env bash
# Minimal backup -> isolated restore drill on sample data (T02). The full drill, with real data
# and a copy stored outside Neon, is T10.
#
#   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run db:restore-drill
#
# Creates two throwaway databases on the TEST_DATABASE_URL server: a source that gets the
# migrations and sample data (no personal data), and an isolated database restored from a
# pg_dump of it. Passes when every table restores identically and the restored database still
# enforces the schema rules. Needs psql, pg_dump and pg_restore no older than the server.
set -euo pipefail
cd "$(dirname "$0")/.."

admin=${TEST_DATABASE_URL:?set TEST_DATABASE_URL to a database on a server where this role may create databases}
run=$(date +%s)_$$
source_db=jsa_drill_source_$run
restore_db=jsa_drill_restore_$run
url_of() { node -e 'const u = new URL(process.argv[1]); u.pathname = `/${process.argv[2]}`; console.log(u.href)' "$admin" "$1"; }
source_url=$(url_of "$source_db")
restore_url=$(url_of "$restore_db")
work=$(mktemp -d)

cleanup() {
  psql "$admin" -q -c "drop database if exists $source_db with (force)" -c "drop database if exists $restore_db with (force)"
  rm -rf "$work"
}
trap cleanup EXIT

psql "$admin" -q -v ON_ERROR_STOP=1 -c "create database $source_db" -c "create database $restore_db"
DATABASE_URL=$source_url npm run --silent db:migrate >/dev/null

# One row or more in every table.
psql "$source_url" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into fact default values returning id as fact_id \gset
insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
  values (:'fact_id', 1, 'Maintained the invoice export.', 'sample', 'retired', true, true);
insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
  values (:'fact_id', 2, 'Maintained the invoice export service.', 'sample', 'confirmed', true, true)
  returning id as fact_version_id \gset
insert into job default values returning id as job_id \gset
insert into job_snapshot (job_id, body, source_url)
  values (:'job_id', 'Billing engineer (Helsinki). You keep invoices correct. Kehittäjä – 开发者.', 'https://example.com/jobs/1')
  returning id as snapshot_id \gset
insert into job_requirement (job_snapshot_id, body, quote, quote_verified)
  values (:'snapshot_id', 'Invoice correctness', 'You keep invoices correct.', true) returning id as requirement_id \gset
insert into match (job_snapshot_id, verdict) values (:'snapshot_id', 'eligible') returning id as match_id \gset
insert into match_requirement values (:'match_id', :'requirement_id', 'met');
insert into match_evidence values (:'match_id', :'requirement_id', :'fact_version_id');
insert into artifact (job_snapshot_id, kind) values (:'snapshot_id', 'resume') returning id as artifact_id \gset
insert into artifact_claim (artifact_id, position, body)
  values (:'artifact_id', 0, 'Maintained the invoice export service.') returning id as claim_id \gset
insert into artifact_claim_fact values (:'claim_id', :'fact_version_id');
insert into application (job_snapshot_id, status, submitted_at) values (:'snapshot_id', 'submitted', now())
  returning id as application_id \gset
insert into application_artifact values (:'application_id', :'artifact_id');
insert into application_fact_version values (:'application_id', :'fact_version_id');
insert into "user" (id, name, email, "emailVerified") values ('drill-user', 'Drill', 'drill@example.test', false);
insert into account (id, "accountId", "providerId", "userId", password, "updatedAt")
  values ('drill-account', 'drill-user', 'credential', 'drill-user', 'not-a-real-hash', now());
insert into session (id, "expiresAt", token, "updatedAt", "userId")
  values ('drill-session', now() + interval '1 day', 'drill-token', now(), 'drill-user');
insert into verification (id, identifier, value, "expiresAt") values ('drill-verification', 'drill', 'drill', now());
insert into source (catalog_id, param, last_success_at) values ('greenhouse_board', 'drill', now())
  returning id as source_id \gset
insert into job_posting (source_id, job_id, external_id, title, location, url)
  values (:'source_id', :'job_id', '1', 'Sample job', 'Helsinki, Finland', 'https://example.test/jobs/1');
SQL

pg_dump --format=custom --no-owner --file "$work/backup.dump" "$source_url"
pg_restore --no-owner --exit-on-error --dbname "$restore_url" "$work/backup.dump"

# "<table> <rows> <md5 of all rows>" for every table, the migrations table included.
checksums() {
  psql "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
select format(
  'select %L || '' '' || count(*) || '' '' || md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from %I t',
  tablename, tablename)
from pg_tables where schemaname = 'public' order by tablename
\gexec
SQL
}
checksums "$source_url" >"$work/source.txt"
checksums "$restore_url" >"$work/restore.txt"
diff "$work/source.txt" "$work/restore.txt"
empty=$(awk '$2 == 0 { print $1 }' "$work/source.txt")
[[ -z $empty ]] || { echo "no sample rows in: $empty" >&2; exit 1; }

# The restored copy still enforces the rules and is up to date with the migrations.
if psql "$restore_url" -q -c "update fact_version set body = 'changed'" 2>/dev/null; then
  echo 'the restored database lets a fact version change its text' >&2
  exit 1
fi
hash=$(psql "$restore_url" -Atq -v ON_ERROR_STOP=1 -c "
  insert into fact_version (fact_id, version, body, source)
  select fact_id, 3, 'Restored.', 'sample' from fact_version limit 1
  returning body_sha256 = encode(sha256(convert_to('Restored.', 'UTF8')), 'hex')")
[[ $hash == t ]] || { echo 'the restored database does not hash new fact versions' >&2; exit 1; }
DATABASE_URL=$restore_url npm run --silent db:migrate | grep -q 'No migrations to run' ||
  { echo 'the restored database has pending migrations' >&2; exit 1; }

echo "restore drill passed: $(wc -l <"$work/source.txt" | tr -d ' ') tables identical after pg_dump -> pg_restore"
cat "$work/source.txt"
