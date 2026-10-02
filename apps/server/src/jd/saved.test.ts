import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  JobDetail,
  JobsResponse,
  SavePageResponse,
  SaveResultsResponse,
  SavedEntry,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

// Made-up LinkedIn job ids and pages.
const linkedIn = (id: number) => `https://www.linkedin.com/jobs/view/${id}/`;
const jobText = `Platform Engineer

About the job
You will run our build systems.
- 3+ years with CI pipelines`;

describe('saving from the desktop app', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const boards: Parameters<typeof fakeGreenhouse>[0] = {};
  const greenhouse = fakeGreenhouse(boards);

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: greenhouse.fetch,
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

  const savePage = async (fields: Record<string, string> = {}) => {
    const res = await call({
      method: 'POST',
      url: '/api/saved-pages',
      payload: {
        url: `${linkedIn(4000000001)}?refId=x`,
        title: 'Platform Engineer',
        company: 'Acme',
        location: 'Helsinki, Uusimaa, Finland (Hybrid)',
        text: jobText,
        ...fields,
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<SavePageResponse>();
  };

  const saveResults = async (entries: SavedEntry[]) => {
    const res = await call({ method: 'POST', url: '/api/saved-results', payload: { entries } });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<SaveResultsResponse>();
  };

  const detail = async (jobId: string) => {
    const res = await call({ method: 'GET', url: `/api/jobs/${jobId}` });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<JobDetail>();
  };

  const listed = async (jobId: string) => {
    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    return jobs.filter((j) => j.id === jobId);
  };

  const count = async (sql: string, params: unknown[] = []) =>
    (await pool.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]!.n;

  test('refuses saves without a session, and from another site', async () => {
    for (const url of ['/api/saved-pages', '/api/saved-results', `/api/jobs/${uuid}/text`]) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { origin: appUrl },
        payload: {},
      });
      assert.equal(res.statusCode, 401, url);
      const cross = await call({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example' },
      });
      assert.equal(cross.statusCode, 403, url);
    }
    assert.equal(await count('saved_job'), 0);
  });

  test('saves a job page once, however often and from whichever address', async () => {
    const first = await savePage();
    assert.deepEqual(
      { ...first, jobId: undefined },
      { jobId: undefined, title: 'Platform Engineer', newJob: true, text: 'first' },
    );

    const job = await detail(first.jobId);
    assert.deepEqual(
      [job.title, job.company, job.url, job.saved, job.sources, job.canImport],
      ['Platform Engineer', 'Acme', linkedIn(4000000001), true, [], false],
    );
    assert.deepEqual(
      [job.snapshot?.catalogId, job.snapshot?.text, job.snapshot?.url],
      ['desktop_save', jobText, linkedIn(4000000001)],
    );
    assert.deepEqual(
      (await listed(first.jobId)).map((j) => [j.origin, j.needsText, j.verdict]),
      [['saved', false, 'in_scope']],
    );

    // The same page again: same job, same text, so nothing new.
    const again = await savePage({ text: `${jobText}\n\n` });
    assert.deepEqual([again.jobId, again.newJob, again.text], [first.jobId, false, 'same']);
    // The same job open beside a search result list, with text that changed since.
    const changed = await savePage({
      url: 'https://www.linkedin.com/jobs/search/?currentJobId=4000000001&keywords=platform',
      text: `${jobText}\n- Go is a plus`,
    });
    assert.deepEqual([changed.jobId, changed.newJob, changed.text], [first.jobId, false, 'new']);
    const now = await detail(first.jobId);
    assert.equal(now.earlierSnapshots, 1);
    assert.match(now.snapshot!.text, /Go is a plus/);
    assert.equal(await count('saved_job where job_id = $1', [first.jobId]), 1);
  });

  test('saves the entries a results page showed, without text, and without duplicates', async () => {
    const entries: SavedEntry[] = [
      { url: linkedIn(4000000011), title: 'Data Engineer', company: 'Beta', location: 'Espoo' },
      {
        url: 'https://fi.linkedin.com/jobs/view/backend-developer-at-gamma-4000000012?position=2',
        title: 'Backend Developer',
        company: 'Gamma',
        location: 'Berlin, Germany',
      },
      // The same job twice on one page counts once.
      { url: `${linkedIn(4000000011)}?trk=x`, title: 'Data Engineer', company: 'Beta' },
    ];
    assert.deepEqual(await saveResults(entries), { saved: 2, newJobs: 2 });
    assert.deepEqual(await saveResults(entries), { saved: 2, newJobs: 0 });
    assert.equal(
      await count('saved_job where url = any($1)', [[linkedIn(4000000011), linkedIn(4000000012)]]),
      2,
    );

    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    const gamma = jobs.find((j) => j.company === 'Gamma')!;
    assert.deepEqual(
      [gamma.url, gamma.origin, gamma.needsText, gamma.verdict, gamma.sources],
      [linkedIn(4000000012), 'saved', true, 'out_of_scope', []],
    );

    // No text, nothing to read it from: the job can be neither summarised nor read.
    const job = await detail(gamma.id);
    assert.deepEqual(
      [job.snapshot, job.canImport, job.saved, job.title],
      [null, false, true, 'Backend Developer'],
    );
    const read = await call({ method: 'POST', url: `/api/jobs/${gamma.id}/snapshots` });
    assert.equal(read.statusCode, 409);
    assert.equal(await count('job_snapshot where job_id = $1', [gamma.id]), 0);
  });

  test('a job saved from a results page gets its text from its page or from pasting', async () => {
    await saveResults([{ url: linkedIn(4000000021), title: 'SRE', company: 'Delta' }]);
    const saved = await savePage({
      url: `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4000000021`,
      title: 'Site Reliability Engineer',
      company: 'Delta',
      location: 'Helsinki, Finland',
    });
    assert.deepEqual([saved.newJob, saved.text], [false, 'first']);
    assert.deepEqual(
      (await listed(saved.jobId)).map((j) => [j.title, j.needsText]),
      [['Site Reliability Engineer', false]],
    );

    await saveResults([{ url: linkedIn(4000000022), title: 'QA Engineer', company: 'Delta' }]);
    const [entry] = await listed(
      (await pool.query('select job_id from saved_job where url = $1', [linkedIn(4000000022)]))
        .rows[0].job_id,
    );
    const pasted = await call({
      method: 'POST',
      url: `/api/jobs/${entry!.id}/text`,
      payload: { text: 'QA Engineer\n\nYou test things.' },
    });
    assert.equal(pasted.statusCode, 200, pasted.body);
    const job = pasted.json<JobDetail>();
    assert.deepEqual(
      [job.snapshot?.catalogId, job.snapshot?.url, job.snapshot?.title, job.snapshot?.company],
      ['paste', linkedIn(4000000022), 'QA Engineer', 'Delta'],
    );
    assert.deepEqual(
      (await listed(entry!.id)).map((j) => [j.origin, j.needsText]),
      [['saved', false]],
    );

    const unknown = await call({
      method: 'POST',
      url: `/api/jobs/${uuid}/text`,
      payload: { text: 'Text.' },
    });
    assert.equal(unknown.statusCode, 404);
  });

  test('a page at the address of a job a board lists is that job', async () => {
    await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'acme' },
    });
    boards['acme'] = [{ id: 31, title: 'Mobile Developer' }];
    await call({ method: 'POST', url: '/api/discovery-runs', payload: {} });
    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    const board = jobs.find((j) => j.title === 'Mobile Developer')!;

    const saved = await savePage({
      url: 'https://job-boards.greenhouse.io/acme/jobs/31#app',
      title: 'Mobile Developer - Acme',
      text: 'Mobile Developer\n\nYou build our app.',
    });
    assert.deepEqual([saved.jobId, saved.newJob], [board.id, false]);
    const job = await detail(board.id);
    assert.deepEqual(
      [job.title, job.saved, job.canImport, job.snapshot?.catalogId],
      ['Mobile Developer', true, true, 'desktop_save'],
    );
    assert.deepEqual(
      (await listed(board.id)).map((j) => [j.origin, j.sources.length]),
      [['discovered', 1]],
    );
  });

  test('refuses pages that are not job pages or not https, and empty text', async () => {
    for (const [fields, message] of [
      [{ url: 'https://www.linkedin.com/feed/' }, /not a job’s page/],
      [{ url: 'https://user:pw@careers.example.com/jobs/1' }, /password/],
      [{ url: 'http://careers.example.com/jobs/1' }, /url/],
      [{ text: ' \n ' }, /text/],
      [{ title: '' }, /title/],
    ] as const) {
      const res = await call({
        method: 'POST',
        url: '/api/saved-pages',
        payload: {
          title: 'Engineer',
          url: 'https://careers.example.com/1',
          text: 'Text.',
          ...fields,
        },
      });
      assert.equal(res.statusCode, 400, JSON.stringify(fields));
      assert.match(res.json().message, message);
    }
    for (const entries of [[], [{ url: 'https://www.linkedin.com/jobs/', title: 'X' }]]) {
      const res = await call({ method: 'POST', url: '/api/saved-results', payload: { entries } });
      assert.equal(res.statusCode, 400, JSON.stringify(entries));
    }
    assert.equal(await count("saved_job where url like 'https://careers.example.com/%'"), 0);
  });
});
