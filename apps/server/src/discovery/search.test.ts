import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { JobDetail, JobSearchRequest, JobSearchResponse } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
import { fakeAshby } from '../testing/ashby.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { toolPriceUsd, toolUrls } from '../tools/provider.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };
const item = (url: string) => ({
  url,
  title: 'Search title',
  snippet: 'Helsinki, all conditions met',
  summary: 'Not the JD',
  content: 'Not the JD',
});
const realText =
  'Official job text: build and maintain our public billing service. Work with the engineering team.';

describe('manual job searches', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let answer: () => Promise<Response> = async () => Response.json({ results: [] });
  const searches: { query: string; count: number; need_content: boolean }[] = [];
  const greenhouse = fakeGreenhouse({
    acme: [
      {
        id: 11,
        title: 'Official Engineer',
        company_name: 'Official Co',
        location: '',
        content: `<p>${realText}</p>`,
      },
      { id: 12, content: '' },
    ],
  });
  const ashby = fakeAshby({
    acme: [
      {
        id: 'a2',
        title: 'Official Ashby job',
        location: 'Berlin',
        country: 'Germany',
        descriptionPlain: realText,
      },
      { id: 'hidden', isListed: false, descriptionPlain: realText },
    ],
  });
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    await pool.query(
      "update profile set name='Private Example',email='private@example.test',phone='+358123456',location='Private home'",
    );
    await pool.query(
      "insert into source(catalog_id,param,enabled) values('greenhouse_board','acme',false)",
    );
    app = buildApp({
      webRoot: '/nonexistent',
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      deepseekApiKey: 'provider-secret',
      fetch: async (url, init) => {
        if (String(url) === toolUrls.search) {
          assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer provider-secret');
          const body = JSON.parse(String(init?.body));
          searches.push(body);
          return answer();
        }
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        if (String(url).startsWith('https://boards-api.greenhouse.io/'))
          return greenhouse.fetch(url);
        if (String(url).startsWith('https://api.ashbyhq.com/')) return ashby.fetch(url);
        throw new Error(`Unexpected network request: ${String(url)}`);
      },
    });
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: account.email, password: account.password },
    });
    cookie = [signIn.headers['set-cookie'] ?? []]
      .flat()
      .find((c) => c.startsWith('better-auth.session_token='))!
      .split(';', 1)[0]!;
  });
  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });
  const call = (options: InjectOptions) =>
    app.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });
  const request = (changes: Partial<JobSearchRequest> = {}): JobSearchRequest => ({
    id: randomUUID(),
    role: 'Engineer',
    location: 'Helsinki',
    sources: ['greenhouse_board', 'ashby_board'],
    maxCostUsd: toolPriceUsd,
    ...changes,
  });
  const search = (payload = request()) =>
    call({ method: 'POST', url: '/api/job-searches', payload });
  const verify = (url: string) =>
    call({ method: 'POST', url: '/api/jobs/import-link', payload: { url } });
  const counts = async () =>
    (
      await pool.query(`select (select count(*) from job)::int as jobs,
    (select count(*) from job_snapshot)::int as texts,(select count(*) from model_call)::int as models`)
    ).rows[0];

  test('opening the search only quotes fees; authentication and trusted Origin protect new routes', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/job-searches' })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/job-searches',
          headers: { cookie },
          payload: request(),
        })
      ).statusCode,
      403,
    );
    assert.deepEqual((await call({ method: 'GET', url: '/api/job-searches' })).json(), {
      available: true,
      estimatedCostUsd: toolPriceUsd,
    });
    assert.equal(searches.length, 0);
  });
  test('source selections and phrases are validated before reserving or sending', async () => {
    const before = searches.length;
    for (const changes of [
      { role: ' ' },
      { role: 'Engineer" OR site:evil.test "' },
      { role: 'x'.repeat(100) },
      { location: '' },
      { sources: [] },
      { sources: ['unsupported'] },
      { maxCostUsd: 0 },
      { sources: ['ashby_board', 'ashby_board'] },
    ]) {
      const payload = { ...request(), ...changes };
      const res = await call({ method: 'POST', url: '/api/job-searches', payload });
      assert.ok([400, 409].includes(res.statusCode), res.body);
      assert.equal(
        (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
        0,
      );
    }
    assert.equal(searches.length, before);
  });
  test('search only discovers links, filters domains, merges aliases and retains a single billable operation', async () => {
    answer = async () =>
      Response.json({
        results: [
          'https://boards.greenhouse.io/ACME/jobs/11?utm_source=search',
          'https://job-boards.greenhouse.io/acme/jobs/11#application',
          'https://jobs.ashbyhq.com/acme/a2/application',
          'https://linkedin.com/jobs/view/11',
          'https://jobs.ashbyhq.com.evil.test/acme/1',
        ].map(item),
      });
    const before = await counts();
    const sources = (await pool.query('select * from source order by id')).rows;
    const payload = { ...request(), privateNotes: 'private note sentinel' };
    const replies = await Promise.all([search(payload), search(payload)]);
    assert.ok(replies.every((r) => r.statusCode === 200));
    const res = await search(payload);
    const body = res.json<JobSearchResponse>();
    assert.equal(body.candidates.length, 2);
    assert.equal(body.ignored.length, 3);
    assert.equal(body.costUsd, toolPriceUsd);
    assert.equal(body.estimated, false);
    assert.equal(searches.length, 1);
    assert.equal(greenhouse.requested.length, 0);
    assert.equal(ashby.requested.length, 0);
    assert.deepEqual(await counts(), before);
    assert.deepEqual((await pool.query('select * from source order by id')).rows, sources);
    assert.deepEqual(Object.keys(searches[0]!).sort(), ['count', 'need_content', 'query']);
    assert.equal(searches[0]!.need_content, false);
    for (const privateText of [
      'private@example.test',
      'Private Example',
      '+358123456',
      'Private home',
      'provider-secret',
      'private note sentinel',
    ]) {
      assert.ok(!searches[0]!.query.includes(privateText));
      assert.ok(!res.body.includes(privateText));
    }
    assert.equal((await search({ ...payload, location: 'Berlin' })).statusCode, 409);
    const onlyGreenhouse = (
      await search(request({ sources: ['greenhouse_board'] }))
    ).json<JobSearchResponse>();
    assert.equal(onlyGreenhouse.candidates.length, 1);
    assert.ok(!onlyGreenhouse.query.includes('ashby'));
  });
  test('selected candidates are verified by official adapters, with original text, deduplication and actual criteria', async () => {
    const beforeSources = (await pool.query('select * from source order by id')).rows;
    const link = 'https://job-boards.greenhouse.io/acme/jobs/11';
    const verified = await verify(link);
    assert.equal(verified.statusCode, 200, verified.body);
    const job = verified.json<JobDetail>();
    assert.equal(job.title, 'Official Engineer');
    assert.equal(job.company, 'Official Co');
    assert.equal(job.location, '');
    assert.equal(job.verdict, 'to_confirm');
    assert.equal(job.snapshot?.text, realText);
    assert.equal(job.snapshot?.catalogId, 'greenhouse_board');
    assert.equal(job.snapshot?.summary, null);
    const beforeCounts = await counts();
    const duplicate = await verify(link);
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().jobs[0].id, job.id);
    assert.deepEqual(await counts(), beforeCounts);
    assert.equal(beforeCounts.models, 0);
    const other = await verify('https://jobs.ashbyhq.com/acme/a2');
    assert.equal(other.statusCode, 200, other.body);
    const ashbyJob = other.json<JobDetail>();
    assert.equal(ashbyJob.snapshot?.catalogId, 'ashby_board');
    assert.equal(ashbyJob.snapshot?.text, realText);
    assert.equal(ashbyJob.verdict, 'ineligible');
    assert.deepEqual((await pool.query('select * from source order by id')).rows, beforeSources);
  });
  test('expired, unlisted and textless jobs fail visibly without changing saved jobs or snapshots', async () => {
    const before = await counts();
    const texts = (await pool.query('select id,body from job_snapshot order by id')).rows;
    for (const url of [
      'https://boards.greenhouse.io/acme/jobs/999',
      'https://boards.greenhouse.io/acme/jobs/12',
      'https://jobs.ashbyhq.com/acme/hidden',
      'https://jobs.ashbyhq.com/acme/expired',
    ]) {
      const res = await verify(url);
      assert.equal(res.statusCode, 502, res.body);
      assert.match(res.json().message, /no longer lists|no text/);
    }
    assert.deepEqual(await counts(), before);
    assert.deepEqual(
      (await pool.query('select id,body from job_snapshot order by id')).rows,
      texts,
    );
  });
  test('empty, unavailable and unknown searches retain fees correctly and never retry automatically', async () => {
    for (const [outcome, cost, estimated] of [
      [async () => Response.json({ results: [] }), 0, false],
      [async () => new Response('provider-secret', { status: 429 }), 0, false],
      [
        async () => {
          throw new Error('timeout provider-secret');
        },
        toolPriceUsd,
        true,
      ],
      [async () => Response.json({ results: 'bad' }), toolPriceUsd, true],
    ] as const) {
      answer = outcome;
      const payload = request();
      const res = await search(payload);
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json<JobSearchResponse>();
      assert.equal(body.costUsd, cost);
      assert.equal(body.estimated, estimated);
      assert.deepEqual(body.candidates, []);
      assert.ok(!res.body.includes('provider-secret'));
      const before = searches.length;
      assert.deepEqual((await search(payload)).json(), body);
      assert.equal(searches.length, before);
    }
  });
});
