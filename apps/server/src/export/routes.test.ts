import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { parseFactsMarkdown } from '../facts/markdown.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { pdfOf } from '../testing/pdf.ts';
import { unzip } from '../testing/zip.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' };
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('export', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const keptPdf = pdfOf(['Test Person', 'Maintained the invoice export service.']);
  const sentPdf = pdfOf(['Test Person', 'The letter as I sent it.']);
  const ids: Record<string, string> = {};

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
    });
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: account.email, password: account.password },
    });
    const setCookie = [signIn.headers['set-cookie'] ?? []].flat();
    cookie = setCookie.find((c) => c.startsWith('better-auth.session_token='))!.split(';', 1)[0]!;

    const one = async (sql: string, params: unknown[] = []) =>
      (await pool.query<{ id: string }>(sql, params)).rows[0]?.id ?? '';
    ids.fact = await one(`insert into fact (kind) values ('experience') returning id`);
    await pool.query(
      `insert into fact_version (fact_id, version, body, source, status) values
         ($1, 1, 'Maintained the invoice export.', 'test', 'retired'),
         ($1, 2, E'Maintained the invoice export service.\n# for 3 years', 'test', 'confirmed')`,
      [ids.fact],
    );
    ids.factVersion = await one(`select id from fact_version where version = 2`);
    const proposed = await one(`insert into fact (kind) values ('skill') returning id`);
    await pool.query(
      `insert into fact_version (fact_id, version, body, source) values ($1, 1, 'Cobol', 'test')`,
      [proposed],
    );
    ids.job = await one('insert into job default values returning id');
    ids.snapshot = await one(
      `insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
       values ($1, 'Billing engineer. You keep invoices correct.', 'paste', 'Billing engineer',
         'Example Oy', 'Helsinki', 'https://example.com/jobs/1') returning id`,
      [ids.job],
    );
    const call = await one(
      `insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms)
       values ('draft', $1, 'test-model', now(), 1) returning id`,
      [ids.snapshot],
    );
    ids.artifact = await one(
      `insert into artifact (job_snapshot_id, kind, model_call_id) values ($1, 'resume', $2)
       returning id`,
      [ids.snapshot, call],
    );
    ids.pdf = await one(
      `insert into document_pdf (artifact_id, body, file_name, pages, text)
       values ($1, $2, 'Test Person - Resume', 1, 'Test Person') returning id`,
      [ids.artifact, keptPdf],
    );
    ids.application = await one(
      `insert into application (job_id, job_snapshot_id, status, submitted_at, method, note)
       values ($1, $2, 'submitted', now() - interval '1 day', 'manual', 'By email') returning id`,
      [ids.job, ids.snapshot],
    );
    await pool.query(
      `insert into application_file (application_id, position, label, file_name, document_pdf_id)
       values ($1, 0, '', 'Test Person - Resume.pdf', $2)`,
      [ids.application, ids.pdf],
    );
    ids.sent = await one(
      `insert into application_file (application_id, position, label, file_name, body)
       values ($1, 1, '', 'Letter.pdf', $2) returning id`,
      [ids.application, sentPdf],
    );
    await pool.query(
      `insert into runner_token (name, token_sha256) values ('Laptop', sha256('secret'::bytea))`,
    );
    ids.token = await one('select id from runner_token');
    ids.form = await one(
      `insert into job_form (job_id, catalog_id, questions) values ($1, 'greenhouse_board', '[]')
       returning id`,
      [ids.job],
    );
    ids.fill = await one(
      `insert into fill_task (job_id, job_form_id, url, fields, status, runner_token_id)
       values ($1, $2, 'https://job-boards.greenhouse.io/embed/job_app?for=x&token=1', '[]',
         'filled', $3) returning id`,
      [ids.job, ids.form, ids.token],
    );
    ids.check = await one(
      `insert into fill_check (fill_task_id, filled_now, fields, screenshot)
       values ($1, true, '[]', $2) returning id`,
      [ids.fill, png],
    );
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  test('needs a signed-in user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export' });
    assert.equal(res.statusCode, 401);
  });

  test('gives one zip with Markdown, JSON, the stored files and a manifest that checks them', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(
      String(res.headers['content-disposition']),
      /^attachment; filename="job-search-export-\d{4}-\d\d-\d\d\.zip"$/,
    );
    assert.equal(res.headers['cache-control'], 'private, no-store');
    const files = unzip(res.rawPayload);

    const manifest = JSON.parse(files.get('manifest.json')!.toString()) as {
      format: string;
      version: number;
      migration: string;
      files: { path: string; bytes: number; sha256: string }[];
    };
    assert.equal(manifest.format, 'job-search-workbench-export');
    assert.equal(manifest.version, 1);
    assert.match(manifest.migration, /^\d+_[a-z-]+$/);
    assert.deepEqual(
      manifest.files.map((f) => f.path).sort(),
      [...files.keys()].filter((p) => p !== 'manifest.json').sort(),
    );
    for (const f of manifest.files) {
      assert.equal(f.sha256, sha256(files.get(f.path)!), f.path);
      assert.equal(f.bytes, files.get(f.path)!.length, f.path);
    }

    // The stored files, byte for byte.
    assert.deepEqual(files.get(`files/document_pdf/${ids.pdf}.pdf`), keptPdf);
    assert.deepEqual(files.get(`files/application_file/${ids.sent}.pdf`), sentPdf);
    assert.deepEqual(files.get(`files/fill_check/${ids.check}.png`), png);

    // facts.md holds only current, confirmed versions, and imports again.
    assert.deepEqual(
      parseFactsMarkdown(files.get('facts.md')!.toString()).map((f) => [f.kind, f.body]),
      [['experience', 'Maintained the invoice export service.\n# for 3 years']],
    );

    const applications = files.get('applications.md')!.toString();
    assert.match(applications, /## Billing engineer — Example Oy/);
    assert.match(
      applications,
      new RegExp(
        `\\[Test Person - Resume\\.pdf\\]\\(<files/document_pdf/${ids.pdf}\\.pdf>\\), SHA-256 ${sha256(keptPdf)}`,
      ),
    );
    assert.match(
      applications,
      new RegExp(`\\[Letter\\.pdf\\]\\(<files/application_file/${ids.sent}\\.pdf>\\)`),
    );

    const data = JSON.parse(files.get('data.json')!.toString()) as Record<
      string,
      Record<string, unknown>[]
    >;
    for (const table of [
      'user',
      'session',
      'account',
      'verification',
      'runner_token',
      'pgmigrations',
    ]) {
      assert.equal(data[table], undefined, table);
    }
    assert.ok(!files.get('data.json')!.toString().includes(account.email));
    assert.deepEqual(
      data.fact_version!.map((v) => v.status),
      [...data.fact_version!]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((v) => v.status),
      'rows are in key order',
    );
    assert.equal(data.fact_version!.length, 3);
    const sentRow = data.application_file!.find((f) => f.id === ids.sent)!;
    assert.deepEqual(sentRow.body, {
      file: `files/application_file/${ids.sent}.pdf`,
      bytes: sentPdf.length,
    });
    assert.equal(sentRow.body_sha256, sha256(sentPdf));
    assert.equal(data.application_file!.find((f) => f.id !== ids.sent)!.body, null);
    assert.deepEqual(
      data.application!.map((a) => a.status),
      ['submitted'],
    );
    assert.deepEqual(data.profile, [
      {
        singleton: true,
        name: '',
        email: '',
        phone: '',
        location: '',
        links: [],
        updated_at: data.profile![0]!.updated_at,
      },
    ]);
  });
});
