import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { JobDetail, JobsResponse, ModelUsage, Source } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { summaryFieldKeys } from '../rules/job-summary.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
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

  const paste = async (fields: Record<string, string> = {}) => {
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
      ['POST', '/api/jobs'],
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

  test('saves a pasted job as its first snapshot and lists it', async () => {
    const job = await paste({ text: `\r\n${pastedText}  \r\n\r\n\r\n` });
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
        saved: false,
        snapshot: {
          id: undefined,
          capturedAt: undefined,
          catalogId: 'paste',
          title: 'Billing Engineer',
          company: 'Acme',
          location: 'Helsinki, Finland',
          url: 'https://careers.example.com/jobs/1',
          text: pastedText,
          summary: null,
          requirements: [],
        },
        earlierSnapshots: 0,
      },
    );

    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    const listed = jobs.find((j) => j.id === job.id);
    assert.deepEqual(
      [listed?.title, listed?.sources, listed?.publishedAt, listed?.verdict],
      ['Billing Engineer', [], null, 'in_scope'],
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
    const job = await paste();
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
    const job = await paste({ title: 'Failing job', text: `${pastedText}\nFailing.` });
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
    const job = await paste({ title: 'Corrected job', text: `${pastedText}\nCorrected.` });
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
});
