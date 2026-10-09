import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  ApplicationRecord,
  ApplicationsResponse,
  Draft,
  DraftDocument,
  Fact,
  JobApplications,
  JobDetail,
  JobsResponse,
  PdfCheck,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { documentPieces } from '../rules/document.ts';
import { submittedLastDay } from '../runner/approvals.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeDeepSeek } from '../testing/deepseek.ts';
import { pdfOf } from '../testing/pdf.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';
const role = 'Backend developer at Acme Oy, 2021-03 – 2024-06';

describe('applications', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const deepseek = fakeDeepSeek(async () => {
    const sent = JSON.parse(deepseek.requests.at(-1)!.body.messages[1]!.content) as {
      facts: { ref: string; text: string }[];
    };
    const ref = sent.facts.find((f) => f.text === role)!.ref;
    const resume = {
      headline: { text: 'Backend developer', facts: [ref] },
      summary: [],
      experience: [{ title: { text: role, facts: [ref] }, bullets: [] }],
    };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(resume) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  });

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: deepseek.fetch,
      deepseekApiKey: 'sk-test',
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
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  const call = (options: InjectOptions) =>
    app.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const ok = async <T>(options: InjectOptions, status = 200) => {
    const res = await call(options);
    assert.equal(res.statusCode, status, res.body);
    return res.json<T>();
  };

  const refused = async (options: InjectOptions, status: number, message?: string) => {
    const res = await call(options);
    assert.equal(res.statusCode, status, res.body);
    if (message) assert.equal(res.json<{ message: string }>().message, message);
  };

  const record = (jobId: string, payload: object) => ({
    method: 'POST' as const,
    url: `/api/jobs/${jobId}/applications`,
    payload: {
      submittedAt: new Date().toISOString(),
      note: '',
      documentPdfIds: [],
      files: [],
      ...payload,
    },
  });

  const sentPdf = pdfOf(['Test Person', 'The resume as I sent it, edited in Word.']);
  const sentAt = '2026-09-20T08:30:00.000Z';
  let jobId = '';
  let keptPdfId = '';
  let applicationId = '';

  test('a job needs its text before an application to it can be recorded', async () => {
    const { rows } = await pool.query<{ id: string }>(
      'insert into job default values returning id',
    );
    const listOnly = rows[0]!.id;
    const state = await ok<JobApplications>({
      method: 'GET',
      url: `/api/jobs/${listOnly}/applications`,
    });
    assert.deepEqual(state, {
      applications: [],
      cannotRecord: 'Save or paste the job’s text first: the record keeps the text you applied to.',
      pdfs: [],
    });
    await refused(record(listOnly, {}), 409, state.cannotRecord!);
    await refused({ method: 'GET', url: `/api/jobs/${uuid}/applications` }, 404);
    await refused(record(uuid, {}), 404);
  });

  test('recording one sent outside the app keeps the text, the match, the files and the facts', async () => {
    await ok({
      method: 'PUT',
      url: '/api/profile',
      payload: { name: 'Test Person', email: '', phone: '', location: '', links: [] },
    });
    const job = await ok<JobDetail>(
      {
        method: 'POST',
        url: '/api/jobs',
        payload: {
          title: 'Billing engineer',
          url: 'https://careers.example.com/jobs/1',
          text: 'Billing engineer (Helsinki). You keep invoices correct.',
        },
      },
      201,
    );
    jobId = job.id;
    const snapshotId = job.snapshot!.id;

    // A kept resume PDF, citing one confirmed fact.
    const fact = await ok<Fact>(
      { method: 'POST', url: '/api/facts', payload: { kind: 'experience', body: role } },
      201,
    );
    await ok({
      method: 'PATCH',
      url: `/api/fact-versions/${fact.current.id}`,
      payload: { status: 'confirmed', maySendToModel: true, mayUseInMaterials: true },
    });
    const draft = await ok<Draft>(
      { method: 'POST', url: `/api/snapshots/${snapshotId}/drafts`, payload: { kind: 'resume' } },
      201,
    );
    const document = await ok<DraftDocument>({
      method: 'GET',
      url: `/api/drafts/${draft.id}/document`,
    });
    const kept = await call({
      method: 'POST',
      url: `/api/drafts/${draft.id}/pdfs`,
      payload: pdfOf(documentPieces(document.blocks)),
      headers: { 'content-type': 'application/pdf' },
    });
    assert.equal(kept.statusCode, 201, kept.body);
    keptPdfId = kept.json<PdfCheck>().pdf!.id;

    // Two matches of the text; the record keeps the later one.
    const { rows } = await pool.query<{ id: string }>(
      `with requirement as (
         insert into job_requirement (job_snapshot_id, body, quote, quote_verified, kind, origin)
         values ($1, 'Invoice correctness', 'You keep invoices correct.', true, 'must', 'model')
         returning id
       ),
       calls as (
         insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms,
           input_tokens, cached_input_tokens, output_tokens, cost_usd)
         select 'match', $1, 'made-up', now(), 1, 1, 0, 1, 0 from generate_series(1, 2)
         returning id
       ),
       matches as (
         insert into match (job_snapshot_id, verdict, model_call_id, created_at)
         select $1, case when row_number() over (order by id) = 1 then 'to_confirm' else 'eligible' end,
           id, now() - (row_number() over (order by id)) * interval '-1 minute' from calls
         returning id, verdict
       )
       insert into match_requirement (match_id, job_requirement_id, outcome, note)
       select m.id, r.id, 'met', 'The fact says so.' from matches m, requirement r
       returning match_id`,
      [snapshotId],
    );
    assert.equal(rows.length, 2);

    const before = await ok<JobApplications>({
      method: 'GET',
      url: `/api/jobs/${jobId}/applications`,
    });
    assert.equal(before.cannotRecord, null);
    assert.deepEqual(
      before.pdfs.map((p) => [p.id, p.kind]),
      [[keptPdfId, 'resume']],
    );

    // Refusals: a time in the future, a PDF of another job, a file that is not a PDF, a file twice.
    await refused(
      record(jobId, { submittedAt: new Date(Date.now() + 3_600_000).toISOString() }),
      400,
      'The time you sent it is in the future.',
    );
    await refused(
      record(jobId, { documentPdfIds: [uuid] }),
      400,
      'A PDF you picked is not one of this job’s.',
    );
    await refused(
      record(jobId, {
        files: [{ fileName: 'notes.txt', body: Buffer.from('Just text').toString('base64') }],
      }),
      400,
      'notes.txt is not a PDF.',
    );
    const keptBody = (await pool.query('select body from document_pdf where id = $1', [keptPdfId]))
      .rows[0].body as Buffer;
    await refused(
      record(jobId, {
        documentPdfIds: [keptPdfId],
        files: [{ fileName: 'Again.pdf', body: keptBody.toString('base64') }],
      }),
      400,
      'The same file is given twice: Again.pdf.',
    );
    assert.equal(Number((await pool.query('select count(*) from application')).rows[0].count), 0);

    const recorded = await ok<JobApplications>(
      record(jobId, {
        submittedAt: sentAt,
        note: '  Sent through the company’s own site. ',
        documentPdfIds: [keptPdfId],
        files: [{ fileName: ' Resume as sent.pdf ', body: sentPdf.toString('base64') }],
      }),
      201,
    );
    const [application] = recorded.applications;
    applicationId = application!.id;
    assert.deepEqual(
      [application!.method, application!.status, application!.submittedAt, recorded.cannotRecord],
      ['manual', 'submitted', sentAt, 'This job’s application went in already.'],
    );
    await refused(record(jobId, {}), 409, 'This job’s application went in already.');

    const frozen = await ok<ApplicationRecord>({
      method: 'GET',
      url: `/api/applications/${applicationId}`,
    });
    assert.equal(frozen.note, 'Sent through the company’s own site.');
    assert.deepEqual(
      [frozen.job.snapshotId, frozen.job.title, frozen.job.text],
      [snapshotId, 'Billing engineer', 'Billing engineer (Helsinki). You keep invoices correct.'],
    );
    assert.deepEqual(
      [frozen.match!.verdict, frozen.match!.requirements],
      [
        'eligible',
        [{ kind: 'must', text: 'Invoice correctness', outcome: 'met', note: 'The fact says so.' }],
      ],
    );
    assert.deepEqual(
      frozen.files.map((f) => [f.label, f.fileName, f.draft?.kind ?? null, f.sha256]),
      [
        [
          '',
          `${document.fileName}.pdf`,
          'resume',
          createHash('sha256').update(keptBody).digest('hex'),
        ],
        ['', 'Resume as sent.pdf', null, createHash('sha256').update(sentPdf).digest('hex')],
      ],
    );
    const download = await call({ method: 'GET', url: frozen.files[1]!.url });
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.deepEqual(download.rawPayload, sentPdf);
    assert.deepEqual(
      frozen.facts.map((f) => [f.factVersionId, f.text, f.stillCurrent]),
      [[fact.current.id, role, true]],
    );
    assert.deepEqual([frozen.form, frozen.receipt], [null, null]);

    // Applied in the list, and not counted toward the runner's 24-hour cap (user decision).
    const { jobs } = await ok<JobsResponse>({ method: 'GET', url: '/api/jobs' });
    assert.equal(jobs.find((j) => j.id === jobId)!.application, 'submitted');
    assert.equal(await submittedLastDay(pool), 0);
    const { applications } = await ok<ApplicationsResponse>({
      method: 'GET',
      url: '/api/applications',
    });
    assert.deepEqual(
      applications.map((a) => [a.id, a.title, a.method]),
      [[applicationId, 'Billing engineer', 'manual']],
    );
  });

  test('later changes to facts, drafts and the job text leave the record as it was', async () => {
    const frozen = await ok<ApplicationRecord>({
      method: 'GET',
      url: `/api/applications/${applicationId}`,
    });
    const { rows } = await pool.query<{ fact_id: string }>(
      'select fact_id from fact_version where body = $1',
      [role],
    );
    await ok(
      {
        method: 'POST',
        url: `/api/facts/${rows[0]!.fact_id}/versions`,
        payload: { body: `${role}, team lead` },
      },
      201,
    );
    await ok(
      {
        method: 'POST',
        url: `/api/jobs/${jobId}/text`,
        payload: { url: 'https://careers.example.com/jobs/1', text: 'The job, rewritten later.' },
      },
      200,
    );
    const later = await ok<ApplicationRecord>({
      method: 'GET',
      url: `/api/applications/${applicationId}`,
    });
    assert.deepEqual(later, {
      ...frozen,
      facts: frozen.facts.map((f) => ({ ...f, stillCurrent: false })),
    });
  });

  test('refusals: no session, no Origin', async () => {
    const noSession = await app.inject({ method: 'GET', url: '/api/applications' });
    assert.equal(noSession.statusCode, 401);
    const crossSite = await app.inject({ ...record(jobId, {}), headers: { cookie } });
    assert.equal(crossSite.statusCode, 403);
    await refused({ method: 'GET', url: `/api/applications/${uuid}` }, 404);
    await refused({ method: 'GET', url: `/api/application-files/${uuid}` }, 404);
  });

  test('database: the record never changes, and one sent by hand went in', async () => {
    await assert.rejects(pool.query(`update application_file set label = 'x'`), /is immutable/);
    await assert.rejects(pool.query('delete from application_file'), /cannot be deleted/);
    await assert.rejects(pool.query('delete from application_fact_version'), /cannot be changed/);
    await assert.rejects(pool.query('delete from application_artifact'), /cannot be changed/);
    await assert.rejects(pool.query(`update application set note = 'x'`), /is immutable/);
    await assert.rejects(pool.query('update application set match_id = null'), /is immutable/);
    await assert.rejects(
      pool.query(`update application set status = 'not_submitted', submitted_at = null`),
      /application_manual_submitted/,
    );
    const { rows } = await pool.query<{ id: string; job_snapshot_id: string }>(
      `select a.id, a.job_snapshot_id from application a where a.id = $1`,
      [applicationId],
    );
    const { job_snapshot_id } = rows[0]!;
    // A file is a kept PDF or an upload, never both; its hash is the database's.
    await assert.rejects(
      pool.query(
        `insert into application_file (application_id, position, label, file_name, document_pdf_id, body)
         values ($1, 5, '', 'both.pdf', $2, '\\x255044462d')`,
        [applicationId, keptPdfId],
      ),
      /application_file_check/,
    );
    const other = await pool.query<{ id: string }>(
      `with j as (insert into job default values returning id),
       s as (
         insert into job_snapshot (job_id, body, catalog_id, title, source_url)
         select id, 'Made up', 'paste', 'Made up', 'https://example.com/made-up' from j
         returning id, job_id
       )
       insert into application (job_id, job_snapshot_id, status, submitted_at, method)
       select job_id, id, 'submitted', now(), 'manual' from s returning id`,
    );
    const inserted = await pool.query<{ body_sha256: string }>(
      `insert into application_file (application_id, position, label, file_name, body, body_sha256)
       values ($1, 0, '', 'a.pdf', '\\x255044462d', 'not the hash') returning body_sha256`,
      [other.rows[0]!.id],
    );
    assert.equal(
      inserted.rows[0]!.body_sha256,
      createHash('sha256').update(Buffer.from('%PDF-')).digest('hex'),
    );
    // A record by hand never goes in later than it was recorded, and never names an approval.
    await assert.rejects(
      pool.query(
        `insert into application (job_id, job_snapshot_id, status, submitted_at, method)
         select job_id, id, 'submitted', now() + interval '1 day', 'manual' from job_snapshot
         where id = $1`,
        [job_snapshot_id],
      ),
      /application_manual_submitted/,
    );
  });
});
