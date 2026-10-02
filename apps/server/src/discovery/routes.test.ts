import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { DiscoveryRun, JobsResponse, Source } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeGreenhouse, type FakeJob } from '../testing/greenhouse.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };

describe('/api/discovery-runs and /api/jobs', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  // What the fake Greenhouse lists; tests change it between runs.
  const boards: Parameters<typeof fakeGreenhouse>[0] = {};
  const greenhouse = fakeGreenhouse(boards);
  const requestTimes: number[] = [];

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: (input, init) => {
        requestTimes.push(Date.now());
        return greenhouse.fetch(input, init);
      },
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

  /** A request from the signed-in user, from the app's own origin. */
  const call = (options: InjectOptions) =>
    app.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const runDiscovery = () => call({ method: 'POST', url: '/api/discovery-runs', payload: {} });

  const listJobs = async () => {
    const res = await call({ method: 'GET', url: '/api/jobs' });
    assert.equal(res.statusCode, 200);
    return res.json<JobsResponse>();
  };

  const addSource = async (param: string) => {
    const res = await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param },
    });
    assert.equal(res.statusCode, 201);
    return res.json<Source>();
  };

  const setScope = (area: string, includeRemote = false) =>
    call({ method: 'PUT', url: '/api/search-scope', payload: { area, includeRemote } });

  test('refuses a run or the list without a session, and a run from another site', async () => {
    for (const [method, url] of [
      ['GET', '/api/jobs'],
      ['POST', '/api/discovery-runs'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: appUrl }, payload: {} });
      assert.equal(res.statusCode, 401, url);
    }
    const res = await call({
      method: 'POST',
      url: '/api/discovery-runs',
      headers: { origin: 'https://evil.example' },
      payload: {},
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(greenhouse.requested, []);
  });

  test('lists no jobs before the first run', async () => {
    assert.deepEqual(await listJobs(), {
      scope: { area: 'helsinki', includeRemote: false },
      jobs: [],
    });
  });

  test('allows one run at a time', async () => {
    const slow = await addSource('slow');
    let release = () => {};
    boards['slow'] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ jobs: [] }));
      });

    const first = runDiscovery();
    while (greenhouse.requested.length === 0) await new Promise((r) => setTimeout(r, 10));
    const second = await runDiscovery();
    assert.equal(second.statusCode, 409);
    assert.match(second.json().message, /already being looked for/);

    release();
    assert.equal((await first).statusCode, 200);
    await call({ method: 'DELETE', url: `/api/sources/${slow.id}` });
  });

  test('lists each job once, in or out of scope or to confirm, newest first', async () => {
    const lower = await addSource('acme');
    // The same board again: Greenhouse board names are not case-sensitive.
    const upper = await addSource('ACME');
    boards['acme'] = [
      { id: 1, title: 'Backend Engineer', location: 'Espoo, Finland' },
      {
        id: 2,
        title: 'Data Engineer',
        location: 'Berlin, Germany; Helsinki, Finland',
        first_published: '2026-09-20T10:00:00Z',
      },
      { id: 3, title: 'Sales Lead', location: 'Berlin, Germany' },
      { id: 4, title: 'Researcher', location: 'Remote' },
      { id: 5, title: 'Designer', location: '' },
    ] satisfies FakeJob[];

    const start = requestTimes.length;
    const res = await runDiscovery();
    assert.equal(res.statusCode, 200);
    const run = res.json<DiscoveryRun>();
    assert.equal(run.requests, 2);
    assert.deepEqual(
      run.sources.map((s) => [s.param, s.outcome, s.found]),
      [
        ['ACME', 'ok', 5],
        ['acme', 'ok', 5],
      ],
    );
    // Greenhouse allows one request every 2 seconds in the catalog.
    const [a, b] = requestTimes.slice(start);
    assert.ok(b! - a! >= 1990, `${b! - a!} ms apart`);

    const { scope, jobs } = await listJobs();
    assert.deepEqual(scope, { area: 'helsinki', includeRemote: false });
    assert.deepEqual(
      jobs.map((j) => [j.title, j.verdict, j.reason]),
      [
        ['Data Engineer', 'in_scope', ''],
        ['Backend Engineer', 'in_scope', ''],
        ['Designer', 'to_confirm', 'No location given.'],
        [
          'Researcher',
          'out_of_scope',
          'Not in Helsinki or Espoo; remote jobs are not in the scope.',
        ],
        ['Sales Lead', 'out_of_scope', 'Not in Helsinki or Espoo.'],
      ],
    );
    const data = jobs[0]!;
    assert.deepEqual(
      { ...data, id: undefined, firstSeenAt: undefined, sources: undefined },
      {
        id: undefined,
        title: 'Data Engineer',
        company: 'Acme',
        location: 'Berlin, Germany; Helsinki, Finland',
        url: 'https://job-boards.greenhouse.io/acme/jobs/2',
        publishedAt: '2026-09-20T10:00:00.000Z',
        firstSeenAt: undefined,
        sources: undefined,
        origin: 'discovered',
        needsText: false,
        verdict: 'in_scope',
        reason: '',
      },
    );
    assert.deepEqual(new Set(data.sources.map((s) => s.id)), new Set([lower.id, upper.id]));

    // Changing the scope reclassifies the same jobs, without a run or a code change.
    await setScope('helsinki', true);
    const remote = (await listJobs()).jobs.find((j) => j.title === 'Researcher');
    assert.deepEqual(
      [remote?.verdict, remote?.reason],
      ['to_confirm', 'Remote, but it does not say from where.'],
    );
    await setScope('worldwide');
    assert.ok((await listJobs()).jobs.every((j) => j.verdict === 'in_scope'));
    await setScope('helsinki');

    // A source that is not in use any more hides the jobs only it lists.
    await call({ method: 'PATCH', url: `/api/sources/${upper.id}`, payload: { enabled: false } });
    assert.equal((await listJobs()).jobs.length, 5);
    await call({ method: 'PATCH', url: `/api/sources/${lower.id}`, payload: { enabled: false } });
    assert.equal((await listJobs()).jobs.length, 0);
    await call({ method: 'PATCH', url: `/api/sources/${lower.id}`, payload: { enabled: true } });
    assert.equal((await listJobs()).jobs.length, 5);
  });

  test('keeps listing a failing board’s jobs and drops jobs a board no longer lists', async () => {
    boards['acme'] = 500;
    const failed = (await runDiscovery()).json<DiscoveryRun>();
    assert.deepEqual(
      failed.sources.map((s) => [s.outcome, s.reason]),
      [['failed', 'boards-api.greenhouse.io answered HTTP 500.']],
    );
    assert.equal((await listJobs()).jobs.length, 5);

    boards['acme'] = [{ id: 1, title: 'Backend Engineer', location: 'Espoo, Finland' }];
    await runDiscovery();
    assert.deepEqual(
      (await listJobs()).jobs.map((j) => j.title),
      ['Backend Engineer'],
    );
  });
});
