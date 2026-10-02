import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';
import { Pool } from 'pg';
import { catalog } from '../sources/catalog.ts';
import { fakeAshby } from '../testing/ashby.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeGreenhouse, type FakeJob } from '../testing/greenhouse.ts';
import { RateLimiter, allAdapters, runDiscovery } from './run.ts';

const log = { warn() {}, error() {} } as unknown as FastifyBaseLogger;

test('the app can read every catalog entry it requests', () => {
  for (const entry of catalog) {
    const requested = entry.access === 'board_api' || entry.access === 'official_api';
    assert.equal(allAdapters[entry.id] !== undefined, requested, entry.id);
  }
});

test('the rate limiter spaces requests to a site and lets other sites through', async () => {
  let clock = 0;
  const waits: number[] = [];
  const limiter = new RateLimiter({
    now: () => clock,
    sleep: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
  });
  const limit = { requests: 1, perSeconds: 2 };

  await limiter.wait('a', limit);
  clock += 500;
  await limiter.wait('a', limit);
  await limiter.wait('b', limit);
  clock += 5000;
  await limiter.wait('a', limit);
  assert.deepEqual(waits, [1500]);

  // Two requests per second: the third waits for the first to leave the window.
  clock = 100_000;
  for (let i = 0; i < 3; i++) await limiter.wait('c', { requests: 2, perSeconds: 1 });
  assert.deepEqual(waits, [1500, 1000]);
});

test('the rate limiter keeps concurrent callers within the limit', async () => {
  let clock = 0;
  const sentAt: number[] = [];
  const limiter = new RateLimiter({
    now: () => clock,
    // 像真实时间一样：同时开始的等待同时结束。
    sleep: async (ms: number) => {
      const until = clock + ms;
      await new Promise((resolve) => setTimeout(resolve));
      clock = Math.max(clock, until);
    },
  });
  // 发现运行和读取职位原文可能同时请求同一网站。
  await Promise.all(
    [1, 2, 3].map(() =>
      limiter.wait('a', { requests: 1, perSeconds: 2 }).then(() => sentAt.push(clock)),
    ),
  );
  assert.deepEqual(sentAt, [0, 2000, 4000]);
});

describe('runDiscovery', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  const limiter = new RateLimiter({ sleep: async () => {} });

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query('delete from job_posting; delete from job; delete from source');
  });

  const addSource = async (catalogId: string, param = '', enabled = true) => {
    const { rows } = await pool.query<{ id: string }>(
      'insert into source (catalog_id, param, enabled) values ($1, $2, $3) returning id',
      [catalogId, param, enabled],
    );
    return rows[0]!.id;
  };

  const run = (boards: Parameters<typeof fakeGreenhouse>[0], requestLimit?: number) => {
    const greenhouse = fakeGreenhouse(boards);
    return runDiscovery({ pool, fetch: greenhouse.fetch, limiter, log, requestLimit }).then(
      (result) => ({ ...result, requested: greenhouse.requested }),
    );
  };

  const postings = async () =>
    (
      await pool.query<{
        source_id: string;
        job_id: string;
        external_id: string;
        title: string;
        closed: boolean;
      }>(
        `select source_id, job_id, external_id, title, closed_at is not null as closed
         from job_posting order by external_id, source_id`,
      )
    ).rows;

  const sourceRow = async (id: string) =>
    (
      await pool.query(
        'select last_success_at, last_failure_at, last_failure_reason from source where id = $1',
        [id],
      )
    ).rows[0];

  test('requests only enabled job boards, never job alerts', async () => {
    await addSource('greenhouse_board', 'acme');
    await addSource('greenhouse_board', 'paused', false);
    await addSource('linkedin_alert');
    await addSource('retired_board', 'gone');

    const result = await run({ acme: [{ id: 1 }], paused: [{ id: 2 }] });

    assert.deepEqual(result.requested, ['https://boards-api.greenhouse.io/v1/boards/acme/jobs']);
    assert.equal(result.requests, 1);
    assert.deepEqual(
      result.sources.map((s) => [s.param, s.outcome]),
      [['acme', 'ok']],
    );
  });

  test('saves the postings a board lists, each as a new job, and records the success', async () => {
    const id = await addSource('greenhouse_board', 'acme');
    const result = await run({ acme: [{ id: 1, title: 'Engineer' }, { id: 2 }, { id: 2 }] });

    assert.deepEqual(result.sources, [
      {
        sourceId: id,
        catalogId: 'greenhouse_board',
        name: 'Greenhouse job boards',
        param: 'acme',
        outcome: 'ok',
        reason: '',
        found: 2,
        added: 2,
        closed: 0,
      },
    ]);
    const saved = await postings();
    assert.deepEqual(
      saved.map((p) => [p.external_id, p.title, p.closed]),
      [
        ['1', 'Engineer', false],
        ['2', 'Job 2', false],
      ],
    );
    assert.notEqual(saved[0]!.job_id, saved[1]!.job_id);
    assert.ok((await sourceRow(id)).last_success_at);
  });

  test('refreshes postings, closes the ones no longer listed and reopens returning ones', async () => {
    await addSource('greenhouse_board', 'acme');
    await run({ acme: [{ id: 1 }, { id: 2 }] });
    const [first] = await postings();

    const second = await run({ acme: [{ id: 1, title: 'Renamed' }, { id: 3 }] });
    assert.deepEqual(
      second.sources.map(({ found, added, closed }) => ({ found, added, closed })),
      [{ found: 2, added: 1, closed: 1 }],
    );
    assert.deepEqual(
      (await postings()).map((p) => [p.external_id, p.title, p.closed]),
      [
        ['1', 'Renamed', false],
        ['2', 'Job 2', true],
        ['3', 'Job 3', false],
      ],
    );
    assert.equal((await postings())[0]!.job_id, first!.job_id);

    const third = await run({ acme: [{ id: 2 }] });
    assert.deepEqual(
      third.sources.map(({ found, added, closed }) => ({ found, added, closed })),
      [{ found: 1, added: 0, closed: 2 }],
    );
    assert.deepEqual(
      (await postings()).map((p) => [p.external_id, p.closed]),
      [
        ['1', true],
        ['2', false],
        ['3', true],
      ],
    );
  });

  test('a posting found through two sources is one job', async () => {
    // Greenhouse board names are not case-sensitive, so these are the same board.
    const lower = await addSource('greenhouse_board', 'acme');
    const upper = await addSource('greenhouse_board', 'ACME');
    const result = await run({ acme: [{ id: 1 }, { id: 2 }] });
    // Only the source read first adds new jobs.
    assert.deepEqual(result.sources.map((s) => s.added).sort(), [0, 2]);

    const saved = await postings();
    assert.equal(saved.length, 4);
    for (const externalId of ['1', '2']) {
      const pair = saved.filter((p) => p.external_id === externalId);
      assert.deepEqual(new Set(pair.map((p) => p.source_id)), new Set([lower, upper]));
      assert.equal(pair[0]!.job_id, pair[1]!.job_id, externalId);
    }
    assert.equal((await pool.query('select * from job')).rowCount, 2);
  });

  test('a failing source keeps the jobs it listed before and records why', async () => {
    const id = await addSource('greenhouse_board', 'acme');
    await run({ acme: [{ id: 1 }] });
    const result = await run({ acme: 503 });

    assert.deepEqual(
      result.sources.map((s) => [s.outcome, s.reason]),
      [['failed', 'boards-api.greenhouse.io answered HTTP 503.']],
    );
    assert.deepEqual(
      (await postings()).map((p) => [p.external_id, p.closed]),
      [['1', false]],
    );
    const row = await sourceRow(id);
    assert.equal(row.last_failure_reason, 'boards-api.greenhouse.io answered HTTP 503.');
    assert.ok(row.last_success_at < row.last_failure_at);
  });

  test('one failing source does not stop the others', async () => {
    await addSource('greenhouse_board', 'broken');
    await addSource('greenhouse_board', 'acme');
    const result = await run({ acme: [{ id: 1 }] });
    assert.deepEqual(
      result.sources.map((s) => [s.param, s.outcome, s.reason]),
      [
        ['acme', 'ok', ''],
        ['broken', 'failed', 'Greenhouse has no job board called broken.'],
      ],
    );
  });

  test('stops at the request limit, and tries the skipped sources first next time', async () => {
    for (const board of ['a', 'b', 'c']) await addSource('greenhouse_board', board);
    const boards = { a: [{ id: 1 }], b: [{ id: 2 }], c: [{ id: 3 }] } satisfies Record<
      string,
      FakeJob[]
    >;

    const first = await run(boards, 2);
    assert.equal(first.requests, 2);
    assert.deepEqual(
      first.sources.map((s) => [s.param, s.outcome, s.reason]),
      [
        ['a', 'ok', ''],
        ['b', 'ok', ''],
        ['c', 'skipped', 'The run reached its limit of 2 requests.'],
      ],
    );
    const second = await run(boards, 2);
    assert.deepEqual(
      second.sources.map((s) => [s.param, s.outcome]),
      [
        ['c', 'ok'],
        ['a', 'ok'],
        ['b', 'skipped'],
      ],
    );
  });

  test('reads Greenhouse and Ashby boards in one run', async () => {
    await addSource('greenhouse_board', 'acme');
    await addSource('ashby_board', 'acme');
    const greenhouse = fakeGreenhouse({ acme: [{ id: 1 }] });
    const ashby = fakeAshby({ acme: [{ id: 'a1', location: 'Turku' }] });
    const fetch = ((input: string) =>
      (input.startsWith('https://api.ashbyhq.com/') ? ashby : greenhouse).fetch(
        input,
      )) as typeof globalThis.fetch;

    const result = await runDiscovery({ pool, fetch, limiter, log });
    assert.deepEqual(
      result.sources.map((s) => [s.name, s.outcome, s.found]),
      [
        ['Ashby job boards', 'ok', 1],
        ['Greenhouse job boards', 'ok', 1],
      ],
    );
    const { rows } = await pool.query<{ external_id: string; location: string }>(
      'select external_id, location from job_posting order by external_id',
    );
    assert.deepEqual(
      rows.map((r) => [r.external_id, r.location]),
      [
        ['1', 'Helsinki, Finland'],
        ['a1', 'Turku, Finland'],
      ],
    );
  });

  test('skips a source the app has no adapter for, without a request', async () => {
    await addSource('greenhouse_board', 'acme');
    const greenhouse = fakeGreenhouse({ acme: [{ id: 1 }] });
    const result = await runDiscovery({
      pool,
      fetch: greenhouse.fetch,
      limiter,
      log,
      adapters: {},
    });
    assert.equal(result.requests, 0);
    assert.deepEqual(greenhouse.requested, []);
    assert.deepEqual(
      result.sources.map((s) => [s.name, s.outcome, s.reason]),
      [['Greenhouse job boards', 'skipped', 'The app cannot read these yet.']],
    );
  });

  test('logs an unexpected failure and records it without its details', async () => {
    const id = await addSource('greenhouse_board', 'acme');
    const errors: unknown[] = [];
    const greenhouse = fakeGreenhouse({
      // PostgreSQL text cannot hold a NUL character, so saving this fails.
      acme: [{ id: 1, title: 'Engineer\u0000' }],
    });
    const result = await runDiscovery({
      pool,
      fetch: greenhouse.fetch,
      limiter,
      log: { warn() {}, error: (...args: unknown[]) => errors.push(args) } as never,
    });

    const reason = 'Something went wrong; the server log has details.';
    assert.deepEqual(
      result.sources.map((s) => [s.outcome, s.reason]),
      [['failed', reason]],
    );
    assert.equal((await sourceRow(id)).last_failure_reason, reason);
    assert.equal(errors.length, 1);
    assert.deepEqual(await postings(), []);
  });
});
