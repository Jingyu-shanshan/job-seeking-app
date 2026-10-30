import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https, { type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { JobDetail, JobsResponse, ModelUsage, Source } from '@jsa/shared';
import { jobLinkImportProblem } from '@jsa/shared/job-link-import';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { summaryFieldKeys } from '../rules/job-summary.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
import { saveJobPage } from './saved.ts';
import { exportArchive } from '../export/export.ts';
import { unzip } from '../testing/zip.ts';
import { fakeGreenhouse, type FakeJob } from '../testing/greenhouse.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

const pastedText = `Billing Engineer

You will keep our invoices correct.

What you bring
- 3+ years of backend development
- Kubernetes is a plus

This role is based in our Helsinki office.`;

const nullFields = Object.fromEntries(summaryFieldKeys.map((key) => [key, null]));

const goodAnswer = {
  responsibilities: [
    { text: 'Keep invoices correct', quote: 'You will keep our invoices correct.' },
  ],
  requirements: [
    { kind: 'nice', text: 'Kubernetes', quote: 'Kubernetes is a plus' },
    { kind: 'must', text: 'A degree in computer science', quote: 'Degree in computer science' },
    { kind: 'must', text: '3+ years of backend', quote: '3+ years of backend development' },
  ],
  fields: {
    ...nullFields,
    location: { value: 'Helsinki', quote: 'based in our Helsinki office' },
  },
};

describe('JD import and summary', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const boards: Parameters<typeof fakeGreenhouse>[0] = {};
  const greenhouse = fakeGreenhouse(boards);
  let answer: () => Promise<Response> = async () => chatCompletion(JSON.stringify(goodAnswer));
  const deepseek = fakeDeepSeek(() => answer(), greenhouse.fetch);

  const options = () => ({
    webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
    databaseUrl: db.url,
    authSecret: secret,
    appUrl,
    trustedOrigins,
    fetch: deepseek.fetch,
  });

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({ ...options(), deepseekApiKey: 'sk-test' });
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

  const call = (options: InjectOptions, on = app) =>
    on.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const detail = async (jobId: string) => {
    const res = await call({ method: 'GET', url: `/api/jobs/${jobId}` });
    assert.equal(res.statusCode, 200);
    return res.json<JobDetail>();
  };

  const paste = async (fields: Record<string, string | boolean> = {}) => {
    const res = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        title: 'Billing Engineer',
        company: 'Acme',
        location: 'Helsinki, Finland',
        url: 'https://careers.example.com/jobs/1',
        text: pastedText,
        ...fields,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json<JobDetail>();
  };

  const summarise = (snapshotId: string, on = app) =>
    call({ method: 'POST', url: `/api/snapshots/${snapshotId}/summary` }, on);

  const usage = async () =>
    (await call({ method: 'GET', url: '/api/model-usage' })).json<ModelUsage>();

  test('refuses every request without a session, and writes from another site', async () => {
    for (const [method, url] of [
      ['GET', `/api/jobs/${uuid}`],
      ['DELETE', `/api/jobs/${uuid}`],
      ['PUT', `/api/jobs/${uuid}/details`],
      ['POST', '/api/jobs'],
      ['POST', '/api/jobs/import-link'],
      ['POST', `/api/jobs/${uuid}/snapshots`],
      ['POST', `/api/snapshots/${uuid}/summary`],
      ['POST', `/api/snapshots/${uuid}/requirements`],
      ['DELETE', `/api/requirements/${uuid}`],
      ['GET', '/api/model-usage'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: appUrl }, payload: {} });
      assert.equal(res.statusCode, 401, url);
      if (method !== 'GET') {
        const cross = await call({ method, url, headers: { origin: 'https://evil.example' } });
        assert.equal(cross.statusCode, 403, url);
      }
    }
    assert.deepEqual(deepseek.requests, []);
    assert.deepEqual(greenhouse.requested, []);
  });

  test('edits imported details without rewriting history and keeps clears after refresh', async () => {
    const before = await paste({
      createNew: true,
      title: 'Details test',
      url: 'https://example.com/details',
    });
    const payload = { title: ' Engineer II ', company: null, location: ' Tampere ', url: null };
    const response = await call({ method: 'PUT', url: `/api/jobs/${before.id}/details`, payload });
    assert.equal(response.statusCode, 200, response.body);
    const updated = response.json<JobDetail>();
    assert.equal(updated.title, 'Engineer II');
    assert.equal(updated.company, null);
    assert.equal(updated.location, 'Tampere');
    assert.equal(updated.url, null);
    assert.equal(updated.canEditDetails, true);
    assert.deepEqual(updated.snapshot, before.snapshot);
    await call({
      method: 'POST',
      url: `/api/jobs/${before.id}/text`,
      payload: { text: pastedText + '\nUpdated source.', url: 'https://example.com/details' },
    });
    const refreshed = await detail(before.id);
    assert.equal(refreshed.company, null);
    assert.equal(refreshed.url, null);
    const listed = (await call({ method: 'GET', url: '/api/jobs' }))
      .json<JobsResponse>()
      .jobs.find((j) => j.id === before.id)!;
    assert.deepEqual(
      [listed.title, listed.company, listed.location, listed.url],
      ['Engineer II', null, 'Tampere', null],
    );
    const data = JSON.parse(
      unzip(await exportArchive(pool))
        .get('data.json')!
        .toString(),
    );
    assert.equal(
      data.job_details.find((row: { job_id: string }) => row.job_id === before.id).location,
      'Tampere',
    );
  });

  test('rejects invalid job details and edits to missing or deleted jobs', async () => {
    const job = await paste({
      createNew: true,
      title: 'Invalid details test',
      url: 'https://example.com/invalid-details',
    });
    const valid = { title: 'Engineer', company: null, location: '', url: null };
    for (const fields of [
      { title: '   ' },
      { title: 'x'.repeat(1001) },
      { company: 'x'.repeat(1001) },
      { location: 'x'.repeat(5001) },
      { url: 'https://example.com/' + 'x'.repeat(2000) },
      { url: 'http://example.com/job' },
      { url: 'https://user:secret@example.com/job' },
      { extra: true },
    ]) {
      const response = await call({
        method: 'PUT',
        url: `/api/jobs/${job.id}/details`,
        payload: { ...valid, ...fields },
      });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal(
      (await call({ method: 'PUT', url: `/api/jobs/${uuid}/details`, payload: valid })).statusCode,
      404,
    );
    await call({ method: 'DELETE', url: `/api/jobs/${job.id}` });
    assert.equal(
      (await call({ method: 'PUT', url: `/api/jobs/${job.id}/details`, payload: valid }))
        .statusCode,
      404,
    );
  });

  test('edits list-only saved jobs without creating a snapshot', async () => {
    const saved = await call({
      method: 'POST',
      url: '/api/saved-results',
      payload: {
        entries: [{ title: 'List only details', url: 'https://example.com/list-details' }],
      },
    });
    assert.equal(saved.statusCode, 200);
    const job = (await call({ method: 'GET', url: '/api/jobs' }))
      .json<JobsResponse>()
      .jobs.find((j) => j.title === 'List only details')!;
    const response = await call({
      method: 'PUT',
      url: `/api/jobs/${job.id}/details`,
      payload: { title: job.title, company: 'Acme Oy', location: '', url: job.url },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json<JobDetail>().snapshot, null);
  });

  test('only imported jobs may be edited and enabled alert-only jobs can be corrected', async () => {
    const {
      rows: [source],
    } = await pool.query(
      "insert into source(catalog_id,param) values('greenhouse_board','details-board') returning id",
    );
    const {
      rows: [job],
    } = await pool.query('insert into job default values returning id');
    await pool.query(
      `insert into job_posting(source_id,job_id,external_id,title,location,url)
      values($1,$2,'details-posting','Discovered only','','https://example.com/discovered-details')`,
      [source.id, job.id],
    );
    const payload = { title: 'Corrected title', company: null, location: '', url: null };
    assert.equal((await detail(job.id)).canEditDetails, false);
    assert.equal(
      (await call({ method: 'PUT', url: `/api/jobs/${job.id}/details`, payload })).statusCode,
      409,
    );
    const {
      rows: [alertSource],
    } = await pool.query(
      "insert into source(catalog_id,param) values('linkedin_alert','details-alert') returning id",
    );
    const {
      rows: [email],
    } = await pool.query(
      `insert into alert_email(source_id,message_key,sender,subject,jobs,unreadable)
      values($1,'details-message','jobs@example.com','Jobs',1,0) returning id`,
      [alertSource.id],
    );
    const {
      rows: [alertJob],
    } = await pool.query('insert into job default values returning id');
    await pool.query(
      `insert into alert_job(source_id,job_id,external_id,title,location,url,alert_email_id)
      values($1,$2,'details-alert','Alert details','',null,$3)`,
      [alertSource.id, alertJob.id, email.id],
    );
    assert.equal(
      (await call({ method: 'PUT', url: `/api/jobs/${alertJob.id}/details`, payload })).statusCode,
      200,
    );
  });

  test('uses current job metadata for duplicate names and presentation while keeping historical addresses', async () => {
    const page = {
      title: 'Original Duplicate Title',
      company: 'Current Metadata Co',
      location: 'Helsinki',
      url: 'https://example.com/current-metadata',
      text: 'A current metadata test job.',
    };
    const saved = await saveJobPage(pool, page, 'desktop_save');
    await saveJobPage(
      pool,
      { ...page, title: 'Senior Duplicate Title', location: 'Tampere' },
      'desktop_save',
    );
    const current = await detail(saved.jobId);
    assert.equal(current.title, 'Senior Duplicate Title');
    const duplicate = await call({ method: 'POST', url: '/api/jobs', payload: page });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.deepEqual(duplicate.json().jobs, [
      {
        id: saved.jobId,
        title: current.title,
        company: current.company,
        location: current.location,
      },
    ]);
    const obsoleteName = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...page, url: 'https://example.com/unrelated-current-metadata' },
    });
    assert.equal(obsoleteName.statusCode, 201, obsoleteName.body);
    const currentName = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...page, title: current.title, url: 'https://example.com/new-current-metadata' },
    });
    assert.equal(currentName.statusCode, 409, currentName.body);
    assert.equal(currentName.json().jobs[0].id, saved.jobId);
  });

  test('rejects URLs that exceed the storage limit after encoding without saving edits or jobs', async () => {
    const job = await paste({
      createNew: true,
      title: 'Encoded URL test',
      url: 'https://example.com/encoded-url-test',
    });
    const url = 'https://example.com/' + '中'.repeat(300);
    const payload = { title: 'Changed title', company: null, location: 'Tampere', url };
    const edited = await call({ method: 'PUT', url: `/api/jobs/${job.id}/details`, payload });
    assert.equal(edited.statusCode, 400, edited.body);
    assert.match(edited.json().message, /link.*too long/i);
    assert.equal((await detail(job.id)).title, job.title);
    const count = async () => (await pool.query('select count(*)::int as n from job')).rows[0].n;
    const before = await count();
    const imported = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...payload, text: 'Encoded URL job text.' },
    });
    assert.equal(imported.statusCode, 400, imported.body);
    assert.match(imported.json().message, /link.*too long/i);
    assert.equal(await count(), before);
  });

  test('reports duplicates without writing, normalizes addresses and explicitly creates another', async () => {
    const payload = {
      title: 'Full-Stack Engineer',
      company: 'Duplicate Acme Oy',
      location: 'Helsinki',
      url: 'https://example.com/duplicate-import',
      text: pastedText,
    };
    const first = await call({ method: 'POST', url: '/api/jobs', payload });
    assert.equal(first.statusCode, 201, first.body);
    const before = first.json<JobDetail>();
    const counts = async () =>
      (
        await pool.query(`select (select count(*) from job) as jobs,
      (select count(*) from saved_job) as saves, (select count(*) from job_snapshot) as snapshots,
      (select count(*) from job_reading) as readings, (select count(*) from model_call) as calls`)
      ).rows[0];
    const previousCounts = await counts();
    const duplicate = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...payload, url: payload.url + '?utm_source=test#top' },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().code, 'duplicate_job');
    assert.deepEqual(
      duplicate.json().jobs.map((j: { id: string }) => j.id),
      [before.id],
    );
    assert.deepEqual(await counts(), previousCounts);
    const another = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...payload, createNew: true },
    });
    assert.equal(another.statusCode, 201, another.body);
    assert.notEqual(another.json<JobDetail>().id, before.id);
    assert.deepEqual((await detail(before.id)).snapshot, before.snapshot);
    const renamed = {
      title: 'Different role',
      company: null,
      location: 'Tampere',
      url: 'https://example.com/corrected-duplicate',
    };
    await call({ method: 'PUT', url: `/api/jobs/${before.id}/details`, payload: renamed });
    const byName = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        ...payload,
        title: 'Fullstack engineer',
        company: 'duplicate acme',
        location: 'Oulu',
        url: 'https://example.com/other-address',
      },
    });
    assert.equal(byName.statusCode, 409, byName.body);
    assert.deepEqual(
      byName.json().jobs.map((j: { id: string }) => j.id),
      [another.json<JobDetail>().id],
    );
    const byOldUrl = await call({ method: 'POST', url: '/api/jobs', payload });
    assert.equal(byOldUrl.statusCode, 409);
    assert.deepEqual(
      byOldUrl
        .json()
        .jobs.map((j: { id: string }) => j.id)
        .sort(),
      [before.id, another.json<JobDetail>().id].sort(),
    );
    const byNewUrl = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...payload, url: renamed.url },
    });
    assert.equal(byNewUrl.statusCode, 409);
    assert.equal(byNewUrl.json().jobs[0].id, before.id);
  });

  test('serializes concurrent normal imports and ignores deleted candidates', async () => {
    const payload = {
      title: 'Concurrent import',
      url: 'https://example.com/concurrent-import',
      text: pastedText,
    };
    const responses = await Promise.all(
      [1, 2].map(() => call({ method: 'POST', url: '/api/jobs', payload })),
    );
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
    const first = responses.find((r) => r.statusCode === 201)!.json<JobDetail>();
    await call({ method: 'DELETE', url: `/api/jobs/${first.id}` });
    const next = await call({ method: 'POST', url: '/api/jobs', payload });
    assert.equal(next.statusCode, 201, next.body);
    assert.notEqual(next.json<JobDetail>().id, first.id);
    const unrelated = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...payload, url: 'https://example.com/missing-company' },
    });
    assert.equal(unrelated.statusCode, 201, unrelated.body);
  });

  test('recognizes LinkedIn aliases and missing company by address', async () => {
    const payload = {
      title: 'LinkedIn duplicate',
      url: 'https://www.linkedin.com/jobs/view/987654321/',
      text: pastedText,
    };
    const first = await call({ method: 'POST', url: '/api/jobs', payload });
    assert.equal(first.statusCode, 201);
    const duplicate = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        ...payload,
        url: 'https://fi.linkedin.com/jobs/view/engineer-at-acme-987654321?utm_source=test',
      },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().jobs[0].id, first.json<JobDetail>().id);
  });

  test('deletes only the selected duplicate from the list and keeps its text and application history', async () => {
    const first = await paste({ createNew: true, title: 'Duplicate to remove' });
    const second = await paste({ createNew: true, title: 'Duplicate to keep' });
    await pool.query(
      `insert into application (job_id, job_snapshot_id, status, submitted_at, method)
       values ($1, $2, 'submitted', now(), 'manual')`,
      [first.id, first.snapshot!.id],
    );
    const remove = () => call({ method: 'DELETE', url: `/api/jobs/${first.id}` });
    assert.equal((await remove()).statusCode, 204);
    assert.equal((await remove()).statusCode, 204);
    const list = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>().jobs;
    assert(!list.some((job) => job.id === first.id));
    assert(list.some((job) => job.id === second.id));
    assert.equal((await detail(first.id)).snapshot!.id, first.snapshot!.id);
    assert.equal(
      (await pool.query('select id from application where job_id = $1', [first.id])).rowCount,
      1,
    );
    assert.equal((await call({ method: 'DELETE', url: `/api/jobs/${uuid}` })).statusCode, 404);
    assert.equal((await call({ method: 'DELETE', url: '/api/jobs/invalid' })).statusCode, 400);
  });

  test('saves a pasted job as its first snapshot and lists it', async () => {
    const job = await paste({ createNew: true, text: `\r\n${pastedText}  \r\n\r\n\r\n` });
    assert.deepEqual(
      {
        ...job,
        id: undefined,
        snapshot: { ...job.snapshot, id: undefined, capturedAt: undefined },
      },
      {
        id: undefined,
        title: 'Billing Engineer',
        company: 'Acme',
        location: 'Helsinki, Finland',
        url: 'https://careers.example.com/jobs/1',
        sources: [],
        canImport: false,
        canEditDetails: true,
        saved: false,
        alerts: [],
        snapshot: {
          id: undefined,
          capturedAt: undefined,
          catalogId: 'paste',
          readings: [],
          title: 'Billing Engineer',
          company: 'Acme',
          location: 'Helsinki, Finland',
          url: 'https://careers.example.com/jobs/1',
          text: pastedText,
          summary: null,
          requirements: [],
          match: null,
          drafts: [],
        },
        earlierSnapshots: 0,
        verdict: 'eligible',
        criteria: [
          {
            criterion: 'location',
            strength: 'hard',
            outcome: 'met',
            effect: 'none',
            reason: 'The location is in your search scope.',
            quote: null,
          },
          {
            criterion: 'mustHaves',
            strength: 'preference',
            outcome: 'unknown',
            effect: 'none',
            reason: 'Summarise the job to find its must-haves.',
            quote: null,
          },
        ],
        factsToSend: 0,
        factsToDraft: 0,
      },
    );

    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    const listed = jobs.find((j) => j.id === job.id);
    assert.deepEqual(
      [listed?.title, listed?.sources, listed?.publishedAt, listed?.verdict],
      ['Billing Engineer', [], null, 'eligible'],
    );

    const res = await call({ method: 'POST', url: `/api/jobs/${job.id}/snapshots` });
    assert.equal(res.statusCode, 409);
  });

  test('refuses a pasted job without an https link or without text', async () => {
    for (const fields of [
      { url: 'http://careers.example.com/jobs/1' },
      { url: 'javascript:alert(1)' },
      { text: ' \n ' },
      { title: '' },
    ]) {
      const res = await call({
        method: 'POST',
        url: '/api/jobs',
        payload: { title: 'Engineer', url: 'https://example.com/1', text: 'Text.', ...fields },
      });
      assert.equal(res.statusCode, 400, JSON.stringify(fields));
    }
  });

  test('reads a discovered job’s text from its board, once per distinct text', async () => {
    const added = await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'acme' },
    });
    const source = added.json<Source>();
    const job: FakeJob = {
      id: 7,
      title: 'Data Engineer',
      content: '&lt;p&gt;You know SQL.&lt;/p&gt;',
    };
    boards['acme'] = [job];
    await call({ method: 'POST', url: '/api/discovery-runs', payload: {} });
    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    const jobId = jobs.find((j) => j.title === 'Data Engineer')!.id;

    const before = await detail(jobId);
    assert.deepEqual([before.snapshot, before.canImport], [null, true]);

    const importText = () => call({ method: 'POST', url: `/api/jobs/${jobId}/snapshots` });
    const first = (await importText()).json<JobDetail>();
    assert.deepEqual(
      [first.snapshot?.catalogId, first.snapshot?.text, first.snapshot?.title],
      ['greenhouse_board', 'You know SQL.', 'Data Engineer'],
    );
    assert.equal(
      greenhouse.requested.at(-1),
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/7',
    );

    const again = (await importText()).json<JobDetail>();
    assert.deepEqual([again.snapshot?.id, again.earlierSnapshots], [first.snapshot?.id, 0]);

    job.content = '&lt;p&gt;You know SQL and Python.&lt;/p&gt;';
    const changed = (await importText()).json<JobDetail>();
    assert.notEqual(changed.snapshot?.id, first.snapshot?.id);
    assert.equal(changed.earlierSnapshots, 1);

    job.content = '&lt;p&gt;You know SQL.&lt;/p&gt;';
    const reverted = (await importText()).json<JobDetail>();
    assert.deepEqual([reverted.snapshot?.id, reverted.earlierSnapshots], [first.snapshot?.id, 1]);

    boards['acme'] = 503;
    const failed = await importText();
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().message, 'boards-api.greenhouse.io answered HTTP 503.');
    boards['acme'] = [job];

    await call({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { enabled: false } });
    const requests = greenhouse.requested.length;
    const disabled = await importText();
    assert.equal(disabled.statusCode, 409);
    assert.equal(greenhouse.requested.length, requests);
    assert.deepEqual([(await detail(jobId)).canImport, (await detail(jobId)).sources], [false, []]);
    await call({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { enabled: true } });

    assert.equal(
      (await call({ method: 'POST', url: `/api/jobs/${uuid}/snapshots` })).statusCode,
      404,
    );
  });

  test('summarises a snapshot once, sending only the job text, and records the call', async () => {
    const job = await paste({ createNew: true });
    const snapshotId = job.snapshot!.id;

    const withoutKey = buildApp(options());
    try {
      const res = await summarise(snapshotId, withoutKey);
      assert.equal(res.statusCode, 503);
    } finally {
      await withoutKey.close();
    }

    const before = await usage();
    const res = await summarise(snapshotId);
    assert.equal(res.statusCode, 200, res.body);
    const snapshot = res.json<JobDetail>().snapshot!;

    const sent = deepseek.requests.at(-1)!;
    assert.equal(sent.body.messages[1]?.content, `<jd>\n${pastedText}\n</jd>`);
    assert.match(sent.body.messages[0]!.content, /JSON/);

    assert.deepEqual(
      { ...snapshot.summary, createdAt: undefined },
      {
        createdAt: undefined,
        model: 'deepseek-flash',
        costUsd: 0.001206,
        responsibilities: [
          {
            text: 'Keep invoices correct',
            quote: 'You will keep our invoices correct.',
            quoteVerified: true,
          },
        ],
        fields: {
          ...nullFields,
          location: {
            value: 'Helsinki',
            quote: 'based in our Helsinki office',
            quoteVerified: true,
          },
        },
      },
    );
    assert.deepEqual(
      snapshot.requirements.map((r) => [r.text, r.kind, r.quoteVerified, r.origin]),
      [
        ['3+ years of backend', 'must', true, 'model'],
        ['Kubernetes', 'nice', true, 'model'],
        ['A degree in computer science', 'must', false, 'model'],
      ],
    );
    assert.deepEqual(await usage(), {
      calls: before.calls + 1,
      failed: before.failed,
      costUsd: Number((before.costUsd + 0.001206).toFixed(6)),
      inputTokens: before.inputTokens + 3000,
      outputTokens: before.outputTokens + 500,
    });

    const requests = deepseek.requests.length;
    const again = await summarise(snapshotId);
    assert.equal(again.statusCode, 409);
    assert.equal(deepseek.requests.length, requests);
    assert.equal((await summarise(uuid)).statusCode, 404);
  });

  test('records a failed call, with its cost when DeepSeek did answer', async () => {
    const job = await paste({
      createNew: true,
      title: 'Failing job',
      text: `${pastedText}\nFailing.`,
    });
    const snapshotId = job.snapshot!.id;
    const before = await usage();

    answer = async () =>
      Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 });
    const noBalance = await summarise(snapshotId);
    assert.equal(noBalance.statusCode, 502);
    assert.equal(noBalance.json().message, 'The DeepSeek account has no balance left (HTTP 402).');

    answer = async () => chatCompletion(JSON.stringify({ summary: 'A billing job.' }));
    const wrongShape = await summarise(snapshotId);
    assert.equal(wrongShape.statusCode, 502);
    assert.equal(
      wrongShape.json().message,
      'The answer from DeepSeek does not have the expected fields.',
    );
    answer = async () => chatCompletion(JSON.stringify(goodAnswer));

    const after = await usage();
    assert.deepEqual([after.calls, after.failed], [before.calls + 2, before.failed + 2]);
    assert.equal(after.costUsd, Number((before.costUsd + 0.001206).toFixed(6)));
    assert.equal((await detail(job.id)).snapshot?.summary, null);
    const { rows } = await pool.query(
      `select failure_reason, input_tokens from model_call
       where job_snapshot_id = $1 order by started_at`,
      [snapshotId],
    );
    assert.deepEqual(rows, [
      {
        failure_reason: 'The DeepSeek account has no balance left (HTTP 402).',
        input_tokens: null,
      },
      {
        failure_reason: 'The answer from DeepSeek does not have the expected fields.',
        input_tokens: 3000,
      },
    ]);
  });

  test('lets the user add, correct and remove requirements, keeping the old ones', async () => {
    const job = await paste({
      createNew: true,
      title: 'Corrected job',
      text: `${pastedText}\nCorrected.`,
    });
    const snapshotId = job.snapshot!.id;
    const summarised = (await summarise(snapshotId)).json<JobDetail>();
    const kubernetes = summarised.snapshot!.requirements.find((r) => r.text === 'Kubernetes')!;

    const add = (payload: Record<string, unknown>) =>
      call({ method: 'POST', url: `/api/snapshots/${snapshotId}/requirements`, payload });

    const corrected = await add({
      text: 'Kubernetes in production',
      quote: 'Kubernetes is a plus',
      kind: 'must',
      replaces: kubernetes.id,
    });
    assert.equal(corrected.statusCode, 201);
    const added = await add({ text: 'Finnish', quote: 'Finnish is required', kind: 'must' });
    const requirements = added.json<JobDetail>().snapshot!.requirements;
    assert.deepEqual(
      requirements.map((r) => [r.text, r.kind, r.quoteVerified, r.origin]),
      [
        ['3+ years of backend', 'must', true, 'model'],
        ['Kubernetes in production', 'must', true, 'user'],
        ['A degree in computer science', 'must', false, 'model'],
        ['Finnish', 'must', false, 'user'],
      ],
    );

    const twice = await add({ text: 'K8s', quote: '', kind: 'nice', replaces: kubernetes.id });
    assert.equal(twice.statusCode, 404);

    const finnish = requirements.find((r) => r.text === 'Finnish')!;
    const removed = await call({ method: 'DELETE', url: `/api/requirements/${finnish.id}` });
    assert.deepEqual(
      removed.json<JobDetail>().snapshot!.requirements.map((r) => r.text),
      ['3+ years of backend', 'Kubernetes in production', 'A degree in computer science'],
    );
    const again = await call({ method: 'DELETE', url: `/api/requirements/${finnish.id}` });
    assert.equal(again.statusCode, 404);

    const { rows } = await pool.query(
      `select body from job_requirement
       where job_snapshot_id = $1 and removed_at is not null order by body`,
      [snapshotId],
    );
    assert.deepEqual(
      rows.map((r) => r.body),
      ['Finnish', 'Kubernetes'],
    );
  });
  test('imports a single board link with its provenance, deduplicates it and reuses summary', async () => {
    boards['link-import'] = [
      {
        id: 701,
        title: 'Linked Billing Engineer',
        company_name: 'Link Import Co',
        content: `<p>${pastedText}</p>`,
      },
    ];
    const callsBefore = deepseek.requests.length;
    const sourcesBefore = (await pool.query('select count(*)::int as n from source')).rows[0].n;
    const importLink = () =>
      call({
        method: 'POST',
        url: '/api/jobs/import-link',
        payload: {
          url: 'https://job-boards.greenhouse.io/link-import/jobs/701?utm_source=alert',
          method: 'direct',
        },
      });
    const imported = await importLink();
    assert.equal(imported.statusCode, 200, imported.body);
    const job = imported.json<JobDetail>();
    assert.equal(job.snapshot?.catalogId, 'greenhouse_board');
    assert.match(job.snapshot!.text, /keep our invoices correct/);
    assert.equal(job.snapshot?.summary, null);
    assert.deepEqual(
      job.snapshot?.readings?.map(({ readAt, ...reading }) => {
        assert.ok(Number.isFinite(Date.parse(readAt)));
        return reading;
      }),
      [
        {
          requestedUrl: 'https://job-boards.greenhouse.io/link-import/jobs/701?utm_source=alert',
          resolvedUrl: 'https://job-boards.greenhouse.io/acme/jobs/701',
          method: 'greenhouse_board',
        },
      ],
    );
    assert.equal(deepseek.requests.length, callsBefore);
    assert.equal(
      (await pool.query('select count(*)::int as n from source')).rows[0].n,
      sourcesBefore,
    );
    const duplicate = await importLink();
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().jobs[0].id, job.id);
    const again = await detail(job.id);
    assert.equal(again.snapshot?.id, job.snapshot?.id);
    assert.equal(again.snapshot?.readings?.length, 1);
    const forced = await call({
      method: 'POST',
      url: '/api/jobs/import-link',
      payload: {
        url: 'https://job-boards.greenhouse.io/link-import/jobs/701?utm_source=alert',
        createNew: true,
      },
    });
    assert.equal(forced.statusCode, 200, forced.body);
    const extra = forced.json<JobDetail>();
    assert.notEqual(extra.id, job.id);
    assert.equal(extra.canEditDetails, true);
    assert.equal(extra.snapshot?.readings?.[0]?.method, 'greenhouse_board');
    const list = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>().jobs;
    assert(list.some((j) => j.id === extra.id && j.imported && j.origin === 'saved'));
    const both = await importLink();
    assert.equal(both.statusCode, 409);
    assert.deepEqual(
      both
        .json()
        .jobs.map((j: { id: string }) => j.id)
        .sort(),
      [job.id, extra.id].sort(),
    );
    const readings = (
      await pool.query('select * from job_reading where job_snapshot_id=$1', [job.snapshot!.id])
    ).rows;
    assert.equal(readings.length, 1);
    await assert.rejects(
      pool.query("update job_reading set requested_url='https://other.example/job' where id=$1", [
        readings[0].id,
      ]),
      /immutable/,
    );
    await assert.rejects(
      pool.query('delete from job_reading where id=$1', [readings[0].id]),
      /cannot be deleted/,
    );
    const archive = unzip(await exportArchive(pool));
    const exported = JSON.parse(archive.get('data.json')!.toString());
    assert.deepEqual(
      exported.job_reading
        .filter((r: { job_snapshot_id: string }) => r.job_snapshot_id === job.snapshot!.id)
        .map((r: { id: string }) => r.id)
        .sort(),
      readings.map((r) => r.id).sort(),
    );
    answer = async () => chatCompletion(JSON.stringify(goodAnswer));
    const analysed = await summarise(job.snapshot!.id);
    assert.equal(analysed.statusCode, 200, analysed.body);
    assert.ok(analysed.json<JobDetail>().snapshot?.summary);
    assert.equal(deepseek.requests.length, callsBefore + 1);
  });

  test('imports a company page, preserves provenance and deduplicates its snapshot', async (t) => {
    t.mock.method(
      https,
      'get',
      (_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
        const request = new EventEmitter();
        queueMicrotask(() => {
          const response = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
          });
          callback(response as IncomingMessage);
          response.emit(
            'data',
            Buffer.from(
              `<script type="application/ld+json">${JSON.stringify({
                '@type': 'JobPosting',
                title: 'Company Billing Engineer',
                description: pastedText,
                hiringOrganization: { name: 'Company Import Co' },
              })}</script>`,
            ),
          );
          response.emit('end');
        });
        return request;
      },
    );
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const callsBefore = deepseek.requests.length;
    const importPage = () =>
      call({
        method: 'POST',
        url: '/api/jobs/import-link',
        payload: { url: 'https://careers.example.com/jobs/billing' },
      });
    const response = await importPage();
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json<JobDetail>();
    assert.equal(job.snapshot?.catalogId, 'company_page');
    assert.equal(job.snapshot?.company, 'Company Import Co');
    assert.equal(job.snapshot?.readings?.[0]?.method, 'company_page');
    assert.equal(
      job.snapshot?.readings?.[0]?.requestedUrl,
      'https://careers.example.com/jobs/billing',
    );
    assert.equal(
      job.snapshot?.readings?.[0]?.resolvedUrl,
      'https://careers.example.com/jobs/billing',
    );
    assert.equal(job.snapshot?.url, 'https://careers.example.com/jobs/billing');
    assert.match(job.snapshot!.text, /keep our invoices correct/);
    assert.equal(job.snapshot?.summary, null);
    const duplicate = await importPage();
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().jobs[0].id, job.id);
    assert.equal((await detail(job.id)).snapshot?.id, job.snapshot?.id);
    assert.equal(deepseek.requests.length, callsBefore);
    const analysed = await summarise(job.snapshot!.id);
    assert.equal(analysed.statusCode, 200, analysed.body);
    assert.ok(analysed.json<JobDetail>().snapshot?.summary);
  });

  test('does not silently merge a new link using corrected-away source names', async () => {
    boards['corrected-import'] = [1201, 1202].map((id) => ({
      id,
      title: 'Old Source Title',
      company_name: 'Corrected Import Co',
      content: '<p>Build reliable systems.</p>',
    }));
    const first = await call({
      method: 'POST',
      url: '/api/jobs/import-link',
      payload: { url: 'https://job-boards.greenhouse.io/corrected-import/jobs/1201' },
    });
    assert.equal(first.statusCode, 200, first.body);
    const job = first.json<JobDetail>();
    await call({
      method: 'PUT',
      url: `/api/jobs/${job.id}/details`,
      payload: { title: 'New title', company: 'New company', location: '', url: job.url },
    });
    const next = await call({
      method: 'POST',
      url: '/api/jobs/import-link',
      payload: { url: 'https://job-boards.greenhouse.io/corrected-import/jobs/1202' },
    });
    assert.equal(next.statusCode, 200, next.body);
    assert.notEqual(next.json<JobDetail>().id, job.id);
  });

  test('Fetch import stays disabled before any network, fee reservation or data mutation', async () => {
    const requests = greenhouse.requested.length;
    const models = deepseek.requests.length;
    const before = (
      await pool.query(`select (select count(*) from job_reading) as readings,
      (select count(*) from tool_call) as calls,(select count(*) from job_snapshot) as texts`)
    ).rows;
    for (const url of [
      'https://boards.greenhouse.io/link-import/jobs/701',
      'https://www.linkedin.com/jobs/view/123',
      'https://127.0.0.1/private',
    ]) {
      const res = await call({
        method: 'POST',
        url: '/api/jobs/import-link',
        payload: { url, method: 'deepseek_fetch' },
      });
      assert.equal(res.statusCode, 409, res.body);
      assert.match(res.json().message, /disabled.*final target URL/);
      assert.match(res.json().message, /No paid Fetch request was sent/);
    }
    assert.equal(greenhouse.requested.length, requests);
    assert.equal(deepseek.requests.length, models);
    assert.deepEqual(
      (
        await pool.query(`select (select count(*) from job_reading) as readings,
      (select count(*) from tool_call) as calls,(select count(*) from job_snapshot) as texts`)
      ).rows,
      before,
    );
  });

  test('invalid provenance rolls back the saved page and snapshot together', async () => {
    const counts = async () =>
      (
        await pool.query(`select (select count(*) from job) as jobs,
      (select count(*) from saved_job) as pages,(select count(*) from job_snapshot) as texts,
      (select count(*) from job_reading) as readings`)
      ).rows;
    const before = await counts();
    await assert.rejects(
      saveJobPage(
        pool,
        {
          url: 'https://careers.example.com/atomic-test',
          title: 'Atomic provenance test',
          text: pastedText,
        },
        'company_page',
        'http://invalid.example',
      ),
      { code: '23514' },
    );
    assert.deepEqual(await counts(), before);
  });

  test('rejects unsupported links without requesting them or calling the model', async () => {
    const requestsBefore = greenhouse.requested.length;
    const callsBefore = deepseek.requests.length;
    for (const url of [
      'https://www.linkedin.com/jobs/view/123',
      'https://duunitori.fi/tyopaikat/tyo/example',
      'https://www.jobly.fi/tyopaikka/example',
      'https://127.0.0.1/private',
      'https://user:password@careers.example.com/jobs/1',
    ]) {
      const response = await call({
        method: 'POST',
        url: '/api/jobs/import-link',
        payload: { url },
      });
      assert.equal(response.statusCode, 400, response.body);
      const reason = jobLinkImportProblem(url);
      if (reason) assert.equal(response.json().message, reason);
    }
    assert.equal(greenhouse.requested.length, requestsBefore);
    assert.equal(deepseek.requests.length, callsBefore);
    boards['link-unavailable'] = 503;
    const failed = await call({
      method: 'POST',
      url: '/api/jobs/import-link',
      payload: { url: 'https://boards.greenhouse.io/link-unavailable/jobs/702' },
    });
    assert.equal(failed.statusCode, 502, failed.body);
    assert.equal(deepseek.requests.length, callsBefore);
  });
});
