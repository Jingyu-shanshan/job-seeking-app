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
insert into fact (kind) values ('experience') returning id as fact_id \gset
insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
  values (:'fact_id', 1, 'Maintained the invoice export.', 'sample', 'retired', true, true);
insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
  values (:'fact_id', 2, 'Maintained the invoice export service.', 'sample', 'confirmed', true, true)
  returning id as fact_version_id \gset
insert into job default values returning id as job_id \gset
insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
  values (:'job_id', 'Billing engineer (Helsinki). You keep invoices correct. Kehittäjä – 开发者.',
    'paste', 'Billing engineer', 'Example Oy', 'Helsinki, Finland', 'https://example.com/jobs/1')
  returning id as snapshot_id \gset
insert into job_requirement (job_snapshot_id, body, quote, quote_verified, kind, origin)
  values (:'snapshot_id', 'Invoice correctness', 'You keep invoices correct.', true, 'must', 'model')
  returning id as requirement_id \gset
insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms, input_tokens,
    cached_input_tokens, output_tokens, cost_usd)
  values ('job_summary', :'snapshot_id', 'sample-model', now(), 1200, 3000, 1000, 500, 0.001206)
  returning id as model_call_id \gset
insert into job_summary (job_snapshot_id, model_call_id, responsibilities, fields)
  values (:'snapshot_id', :'model_call_id',
    '[{"text": "Keep invoices correct", "quote": "You keep invoices correct.", "quoteVerified": true}]',
    '{"location": {"value": "Helsinki", "quote": "(Helsinki)", "quoteVerified": true}, "salary": null}');
insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms, input_tokens,
    cached_input_tokens, output_tokens, cost_usd)
  values ('match', :'snapshot_id', 'sample-model', now(), 900, 800, 0, 200, 0.00048)
  returning id as match_call_id \gset
insert into match (job_snapshot_id, verdict, model_call_id)
  values (:'snapshot_id', 'eligible', :'match_call_id') returning id as match_id \gset
insert into match_fact values (:'match_id', :'fact_version_id');
insert into match_requirement values (:'match_id', :'requirement_id', 'met', 'The sample fact says so.');
insert into match_evidence values (:'match_id', :'requirement_id', :'fact_version_id');
update job_criteria set title_strength = 'hard', title_words = '{engineer}',
  language_strength = 'preference', languages = '{English}';
insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms, input_tokens,
    cached_input_tokens, output_tokens, cost_usd)
  values ('draft', :'snapshot_id', 'sample-model', now(), 2100, 1500, 0, 600, 0.00117)
  returning id as draft_call_id \gset
insert into artifact (job_snapshot_id, kind, model_call_id)
  values (:'snapshot_id', 'resume', :'draft_call_id') returning id as artifact_id \gset
insert into artifact_fact values (:'artifact_id', :'fact_version_id');
insert into artifact_claim (artifact_id, position, body, section, block, line, about)
  values (:'artifact_id', 0, 'Maintained the invoice export service.', 'experience', 0, 'bullet', 'me')
  returning id as claim_id \gset
insert into artifact_claim_fact (artifact_claim_id, artifact_id, fact_version_id)
  values (:'claim_id', :'artifact_id', :'fact_version_id');
update profile set name = 'Sample Person', email = 'sample@example.test', links = '{https://example.test/}';
insert into artifact_claim_edit (artifact_id, artifact_claim_id, body, included)
  values (:'artifact_id', :'claim_id', 'Maintained the invoice export.', true)
  returning id as edit_id \gset
insert into document_pdf (artifact_id, body, file_name, pages, text)
  values (:'artifact_id', convert_to('%PDF-1.4 sample', 'UTF8'), 'Sample Person - Resume', 1,
    E'Sample Person\nMaintained the invoice export.')
  returning id as pdf_id \gset
insert into document_pdf_statement values (:'pdf_id', :'artifact_id', :'claim_id', :'edit_id');
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
insert into saved_job (job_id, url, title, company, location)
  values (:'job_id', 'https://example.test/jobs/1', 'Sample job', 'Example', 'Helsinki, Finland');
insert into source (catalog_id) values ('linkedin_alert') returning id as alert_source_id \gset
insert into alert_email (source_id, message_key, sender, subject, sent_at, jobs, unreadable)
  values (:'alert_source_id', 'drill@example.test', 'alerts@example.test', 'Sample alert', now(), 1, 0)
  returning id as alert_email_id \gset
insert into alert_job (source_id, job_id, url, external_id, title, company, location, alert_email_id)
  values (:'alert_source_id', :'job_id', 'https://example.test/jobs/2', '2', 'Sample job', 'Example',
    'Helsinki', :'alert_email_id');
insert into form_answer (wordings, answer, sensitive, places)
  values ('{What is your notice period?}', '{One month}', false, '{Finland}');
insert into job_form (job_id, catalog_id, questions)
  values (:'job_id', 'greenhouse_board', '[{"key": "question_1", "label": "What is your notice period?",
    "description": "", "required": true, "kind": "text", "options": [], "group": "questions"}]')
  returning id as job_form_id \gset
insert into job_form_answer (job_id, question_key, label, answer)
  values (:'job_id', 'question_1', 'What is your notice period?', '{Two months}');
insert into runner_token (name, token_sha256, last_used_at)
  values ('Drill runner', sha256('drill'::bytea), now())
  returning id as runner_token_id \gset
insert into fill_task (job_id, job_form_id, url, fields, status, message, runner_token_id, runner_seen_at)
  values (:'job_id', :'job_form_id', 'https://job-boards.greenhouse.io/embed/job_app?for=drill&token=1',
    '[{"key": "question_1", "label": "What is your notice period?", "kind": "text", "group": "questions",
      "required": true, "answer": ["Two months"], "source": "job", "documentPdfId": null}]',
    'submitted', 'Greenhouse showed its confirmation page: the application went in.',
    :'runner_token_id', now())
  returning id as fill_task_id \gset
insert into fill_check (fill_task_id, filled_now, fields, screenshot)
  values (:'fill_task_id', true, '[{"key": "question_1", "label": "What is your notice period?",
    "required": true, "kind": "text", "value": ["Two months"]}]',
    decode('89504e470d0a1a0a0000000d49484452', 'hex'))
  returning id as fill_check_id \gset
insert into submit_approval (fill_task_id, fill_check_id, job_snapshot_id, used_at)
  values (:'fill_task_id', :'fill_check_id', :'snapshot_id', now())
  returning id as approval_id \gset
insert into application (job_id, job_snapshot_id, submit_approval_id, status, submitted_at, method,
    match_id)
  values (:'job_id', :'snapshot_id', :'approval_id', 'submitted', now(), 'runner', :'match_id')
  returning id as application_id \gset
insert into application_file (application_id, position, label, file_name, document_pdf_id)
  values (:'application_id', 0, 'Resume/CV', 'Sample Person - Resume.pdf', :'pdf_id');
insert into application_file (application_id, position, label, file_name, body)
  values (:'application_id', 1, '', 'Sent letter.pdf', convert_to('%PDF-1.4 sent', 'UTF8'));
insert into application_artifact values (:'application_id', :'artifact_id');
insert into application_fact_version values (:'application_id', :'fact_version_id');
insert into submit_receipt (application_id, confirmed, page_url, page_text, note, screenshot)
  values (:'application_id', true,
    'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=drill&token=1',
    'Thank you for applying.', '', decode('89504e470d0a1a0a0000000d49484452', 'hex'));
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
