import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { RunConfig } from '@jsa/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Pool } from 'pg';
import { RateLimiter } from '../discovery/run.ts';
import { deepseek } from '../model/deepseek.ts';
import { withModelLock } from '../model/lock.ts';
import { reserveModelCost } from '../rules/run-budget.ts';
import { toolPriceUsd, toolUrls } from '../tools/provider.ts';
import { fakeDeepSeek } from '../testing/deepseek.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { BudgetStop, RunBudget } from './budget.ts';
import { createRun, endRun, loadRun } from './store.ts';
import { prepareRun } from './worker.ts';
const config: RunConfig = {
  name: 'Sample run',
  discoveryLimit: 2,
  materialLimit: 0,
  submissionLimit: 1,
  requestLimit: 10,
  timeLimitSeconds: 600,
  costLimitUsd: 1,
  intervalHours: 0,
};
const log = { warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;

test('cost reservation covers maximum output and UTF-8 input including chat framing', () => {
  const body = JSON.stringify({ max_tokens: 8000, messages: [{ content: '你好' }] });
  assert.ok(reserveModelCost(body) > (8000 * deepseek.pricePerMillion.output) / 1e6);
});

describe('persistent run budgets and checkpoints', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
  });
  after(async () => {
    await pool?.end();
    await db?.drop();
  });
  const newRun = async (changes: Partial<RunConfig> = {}) => {
    await pool.query(
      "update search_run set status='ready',active_since=null where status in('queued','running')",
    );
    const { rows } = await pool.query<{ id: string }>(
      'insert into run_preset(config) values($1) returning id',
      [JSON.stringify({ ...config, ...changes })],
    );
    const id = await createRun(pool, rows[0]!.id);
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    return id;
  };
  test('captures preset, sources and criteria, and forbids rewriting the run snapshot', async () => {
    await pool.query(
      "insert into source(catalog_id,param,enabled) values('greenhouse_board','sample',true) on conflict do nothing",
    );
    const id = await newRun();
    const run = await loadRun(pool, id);
    await pool.query('update run_preset set config=$2 where id=$1', [
      run.presetId,
      JSON.stringify({ ...config, requestLimit: 500 }),
    ]);
    await pool.query("update source set enabled=false where param='sample'");
    await pool.query("update job_criteria set area='worldwide'");
    const after = await loadRun(pool, id);
    assert.equal(after.config.requestLimit, 10);
    assert.equal(after.sources[0]?.enabled, true);
    assert.equal(after.criteria.location.area, run.criteria.location.area);
    await assert.rejects(pool.query("update search_run set config='{}' where id=$1", [id]));
    await pool.query("update source set enabled=true where param='sample'");
  });
  test('concurrent requests cannot exceed the request limit; restarting the budget does not reset it', async () => {
    const id = await newRun({ requestLimit: 1 });
    let sent = 0;
    const fetch: typeof globalThis.fetch = async () => {
      sent++;
      return Response.json({});
    };
    const a = new RunBudget({ pool, id, fetch }),
      b = new RunBudget({ pool, id, fetch });
    const results = await Promise.allSettled([
      a.fetch('https://example.com/'),
      b.fetch('https://example.com/'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(sent, 1);
    await assert.rejects(
      new RunBudget({ pool, id, fetch }).fetch('https://example.com/'),
      BudgetStop,
    );
    assert.equal((await loadRun(pool, id)).requests, 1);
  });
  test('zero or insufficient cost budget prevents model sending before charging a request', async () => {
    const id = await newRun({ costLimitUsd: 0 });
    const fake = fakeDeepSeek({});
    await assert.rejects(
      new RunBudget({ pool, id, fetch: fake.fetch }).fetch(deepseek.url, {
        body: JSON.stringify({ max_tokens: 100 }),
      }),
      BudgetStop,
    );
    assert.equal(fake.requests.length, 0);
    assert.equal((await loadRun(pool, id)).requests, 0);
  });
  test('unknown usage keeps the reservation across stop and resume', async () => {
    const id = await newRun();
    const body = JSON.stringify({ max_tokens: 8000, messages: [] });
    const fake: typeof globalThis.fetch = async () => {
      throw new Error('lost connection');
    };
    await assert.rejects(new RunBudget({ pool, id, fetch: fake }).fetch(deepseek.url, { body }));
    const before = await loadRun(pool, id);
    assert.equal(before.costUsd, reserveModelCost(body));
    await endRun(pool, id, 'paused', 'Stopped');
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    const after = await loadRun(pool, id);
    assert.equal(after.costUsd, before.costUsd);
    assert.equal(after.requests, 1);
  });
  test('reported failure usage is counted, with the unused reservation released', async () => {
    const id = await newRun();
    const fake = fakeDeepSeek({});
    await new RunBudget({ pool, id, fetch: fake.fetch }).fetch(deepseek.url, {
      body: JSON.stringify({ max_tokens: 8000 }),
    });
    assert.equal((await loadRun(pool, id)).costUsd, 0.001206);
  });
  test('Search and Fetch share atomic request, cost and time budgets and settle empty results', async () => {
    for (const tool of ['search', 'fetch'] as const) {
      let sent = 0;
      const fetch: typeof globalThis.fetch = async () => {
        sent++;
        return Response.json(tool === 'search' ? { results: [] } : { title: '', content: '' });
      };
      const blocked = await newRun({ costLimitUsd: toolPriceUsd - 0.00001 });
      await assert.rejects(
        new RunBudget({ pool, id: blocked, fetch }).fetch(toolUrls[tool]),
        BudgetStop,
      );
      assert.equal(sent, 0);
      assert.equal((await loadRun(pool, blocked)).requests, 0);
      const id = await newRun({ costLimitUsd: toolPriceUsd, requestLimit: 1 });
      const outcomes = await Promise.allSettled(
        [0, 1].map(() => new RunBudget({ pool, id, fetch }).fetch(toolUrls[tool])),
      );
      assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(sent, 1);
      assert.equal((await loadRun(pool, id)).requests, 1);
      assert.equal((await loadRun(pool, id)).costUsd, 0);
      const expired = await newRun({ timeLimitSeconds: 1 });
      await pool.query('update search_run set elapsed_ms=1001 where id=$1', [expired]);
      await assert.rejects(
        new RunBudget({ pool, id: expired, fetch }).fetch(toolUrls[tool]),
        BudgetStop,
      );
      assert.equal(sent, 1);
    }
  });
  test('tool success is billed, HTTP failures are free, and unknown reservations survive restart and resume', async () => {
    const id = await newRun();
    for (const [response, expected] of [
      [Response.json({ title: '', content: 'Page' }), toolPriceUsd],
      [new Response('limited', { status: 429 }), toolPriceUsd],
      [Response.json({ invalid: true }), 2 * toolPriceUsd],
    ] as const) {
      await new RunBudget({ pool, id, fetch: async () => response }).fetch(toolUrls.fetch);
      assert.equal((await loadRun(pool, id)).costUsd, expected);
    }
    await assert.rejects(
      new RunBudget({
        pool,
        id,
        fetch: async () => {
          throw new Error('lost');
        },
      }).fetch(toolUrls.search),
    );
    await endRun(pool, id, 'paused', 'Stopped');
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    const resumed = await loadRun(pool, id);
    assert.equal(resumed.costUsd, 0.00225);
    assert.equal(resumed.requests, 4);
    const budget = new RunBudget({
      pool,
      id,
      fetch: async () => {
        throw new Error('must not send');
      },
    });
    budget.controller.abort();
    await assert.rejects(budget.fetch(toolUrls.search), BudgetStop);
    assert.equal((await loadRun(pool, id)).requests, 4);
  });
  test('stopping an in-flight tool keeps its charge and request count across a new budget', async () => {
    const id = await newRun();
    const started = Promise.withResolvers<void>();
    const budget = new RunBudget({
      pool,
      id,
      fetch: async (_url, init) => {
        assert.equal((await loadRun(pool, id)).costUsd, toolPriceUsd);
        started.resolve();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          });
        });
      },
    });
    const pending = budget.fetch(toolUrls.search);
    await started.promise;
    budget.controller.abort();
    await assert.rejects(pending);
    await endRun(pool, id, 'paused', 'Stopped');
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    await new RunBudget({ pool, id, fetch: async () => Response.json({ results: [] }) }).fetch(
      toolUrls.search,
    );
    const run = await loadRun(pool, id);
    assert.equal(run.costUsd, toolPriceUsd);
    assert.equal(run.requests, 2);
  });
  test('running time is cumulative and prevents sending after the deadline', async () => {
    const id = await newRun({ timeLimitSeconds: 1 });
    let sent = false;
    await pool.query('update search_run set elapsed_ms=1001 where id=$1', [id]);
    const fetch: typeof globalThis.fetch = async () => {
      sent = true;
      return new Response();
    };
    await assert.rejects(
      new RunBudget({ pool, id, fetch }).fetch('https://example.com/'),
      BudgetStop,
    );
    assert.equal(sent, false);
  });
  test('a completed source is not requested again on resume; job cap never truncates stored postings', async () => {
    await pool.query("update source set enabled=true where param='sample'");
    const id = await newRun({ discoveryLimit: 1 });
    const board = fakeGreenhouse({
      sample: [
        { id: 1, title: 'Engineer', location: 'Helsinki' },
        { id: 2, title: 'Developer', location: 'Helsinki' },
        { id: 3, title: 'Tester', location: 'Helsinki' },
      ],
    });
    const options = {
      pool,
      fetch: board.fetch,
      limiter: new RateLimiter({ sleep: async () => {} }),
      log,
      deepseekApiKey: undefined,
    };
    await prepareRun(options, id, new RunBudget({ pool, id, fetch: board.fetch }));
    const first = await loadRun(pool, id);
    assert.equal(first.status, 'ready');
    assert.equal(first.requests, 1);
    assert.equal(first.jobs.length, 1);
    assert.equal(
      (await pool.query('select count(*)::int as n from job_posting where closed_at is null'))
        .rows[0].n,
      3,
    );
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    await prepareRun(options, id, new RunBudget({ pool, id, fetch: board.fetch }));
    assert.equal((await loadRun(pool, id)).requests, 1);
  });
  test('failed draft retries keep the material slot and costs and never duplicate a saved draft', async () => {
    await pool.query("update source set enabled=true where param='sample'");
    await pool.query("update job_criteria set area='worldwide'");
    await pool.query(`with f as(insert into fact(kind) values('skill') returning id)
      insert into fact_version(fact_id,version,body,source,status,may_send_to_model,may_use_in_materials)
      select id,1,'Built APIs in Go.','Sample test','confirmed',true,true from f`);
    const id = await newRun({ discoveryLimit: 1, materialLimit: 2 });
    const board = fakeGreenhouse({
      sample: [{ id: 10, title: 'Engineer', location: 'Helsinki', content: 'Build APIs in Go.' }],
    });
    let fail = true,
      models = 0;
    const fake = fakeDeepSeek(async () => {
      models++;
      const body = JSON.parse(String(requestBody));
      const system = body.messages[0].content as string;
      let answer: unknown;
      if (system.includes('You read one job description'))
        answer = {
          responsibilities: [],
          requirements: [{ kind: 'must', text: 'Go', quote: 'Go' }],
          fields: Object.fromEntries(
            [
              'location',
              'workplace',
              'employmentType',
              'languages',
              'seniority',
              'salary',
              'visaSponsorship',
            ].map((k) => [k, null]),
          ),
        };
      else if (system.includes('You compare'))
        answer = {
          requirements: [{ ref: 'R1', outcome: 'met', facts: ['F1'], note: 'Built APIs in Go.' }],
        };
      else if (system.includes('resume'))
        answer = { headline: { text: 'Built APIs in Go.', facts: ['F1'] }, summary: [] };
      else if (fail) answer = { invalid: true };
      else answer = { paragraphs: [[{ about: 'me', text: 'Built APIs in Go.', facts: ['F1'] }]] };
      return (await import('../testing/deepseek.ts')).chatCompletion(JSON.stringify(answer));
    }, board.fetch);
    let requestBody: RequestInit['body'];
    const fetch: typeof globalThis.fetch = (input, init) => {
      requestBody = init?.body;
      return fake.fetch(input, init);
    };
    const options = {
      pool,
      fetch,
      limiter: new RateLimiter({ sleep: async () => {} }),
      log,
      deepseekApiKey: 'test-key',
    };
    await prepareRun(options, id, new RunBudget({ pool, id, fetch }));
    const first = await loadRun(pool, id);
    assert.equal(first.status, 'failed');
    assert.equal(first.materials, 2);
    assert.equal(models, 4);
    assert.equal((await pool.query('select count(*)::int as n from artifact')).rows[0].n, 1);
    fail = false;
    await pool.query("update search_run set status='running',active_since=now() where id=$1", [id]);
    await prepareRun(options, id, new RunBudget({ pool, id, fetch }));
    const next = await loadRun(pool, id);
    assert.equal(next.status, 'ready');
    assert.equal(next.materials, 2);
    assert.equal(models, 5);
    assert.equal(next.requests, first.requests + 1);
    assert.ok(next.costUsd > first.costUsd);
    assert.equal((await pool.query('select count(*)::int as n from artifact')).rows[0].n, 2);
    assert.equal((await pool.query('select count(*)::int as n from application')).rows[0].n, 0);
  });
  test('a disabled captured source is not requested after resume', async () => {
    const id = await newRun();
    await pool.query("update source set enabled=false where param='sample'");
    let sent = false;
    const fetch: typeof globalThis.fetch = async () => {
      sent = true;
      return new Response();
    };
    await prepareRun(
      { pool, fetch, limiter: new RateLimiter(), log, deepseekApiKey: undefined },
      id,
      new RunBudget({ pool, id, fetch }),
    );
    assert.equal(sent, false);
    assert.equal((await loadRun(pool, id)).status, 'ready');
  });
  test('job text cannot switch to a source added after the captured run settings', async () => {
    await pool.query("update source set enabled=true where param='sample'");
    const id = await newRun({ materialLimit: 1 });
    const job = (
      await pool.query<{ id: string }>(`select id from job where not exists
      (select 1 from job_snapshot where job_id=job.id) limit 1`)
    ).rows[0]!.id;
    await pool.query('insert into run_job(run_id,job_id,title) values($1,$2,$3)', [
      id,
      job,
      'Engineer',
    ]);
    const source = (
      await pool.query<{ id: string }>(
        "insert into source(catalog_id,param,enabled) values('greenhouse_board','outside',true) returning id",
      )
    ).rows[0]!.id;
    await pool.query(
      `insert into job_posting(source_id,job_id,external_id,title,location,url)
      values($1,$2,'9','Engineer','Helsinki','https://example.com/job')`,
      [source, job],
    );
    await pool.query("update source set enabled=false where param='sample'");
    let sent = 0;
    const fetch: typeof globalThis.fetch = async () => {
      sent++;
      return new Response();
    };
    await prepareRun(
      { pool, fetch, limiter: new RateLimiter(), log, deepseekApiKey: 'test-key' },
      id,
      new RunBudget({ pool, id, fetch }),
    );
    assert.equal(sent, 0);
    assert.equal((await loadRun(pool, id)).status, 'failed');
    await pool.query('update source set enabled=false where id=$1', [source]);
  });
  test('model operations share locks between UI and background calls', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((r) => {
      finish = r;
    });
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const first = withModelLock(pool, 'sample-step', async () => {
      entered();
      await waiting;
    });
    await started;
    try {
      await assert.rejects(
        withModelLock(pool, 'sample-step', async () => {}),
        /already running/,
      );
    } finally {
      finish();
      await first;
    }
  });
  test('submission budget is atomic, rolled back on duplicate applications, and retained for unknown results', async () => {
    const id = await newRun({ submissionLimit: 1 });
    await pool.query("update search_run set status='ready',active_since=null where id=$1", [id]);
    const make = async (runId = id) => {
      const job = (await pool.query<{ id: string }>('insert into job default values returning id'))
        .rows[0]!.id;
      const snapshot = (
        await pool.query<{ id: string }>(
          "insert into job_snapshot(job_id,body,catalog_id,title,location,source_url) values($1,'Sample text','paste','Engineer','Helsinki','https://example.com/job') returning id",
          [job],
        )
      ).rows[0]!.id;
      const form = (
        await pool.query<{ id: string }>(
          "insert into job_form(job_id,catalog_id,questions) values($1,'greenhouse_board','[]') returning id",
          [job],
        )
      ).rows[0]!.id;
      const fill = (
        await pool.query<{ id: string }>(
          "insert into fill_task(job_id,job_form_id,url,fields,run_id) values($1,$2,'https://example.com/form','[]',$3) returning id",
          [job, form, runId],
        )
      ).rows[0]!.id;
      const check = (
        await pool.query<{ id: string }>(
          "insert into fill_check(fill_task_id,filled_now,fields,screenshot) values($1,false,'[]',decode('89504e470d0a1a0a','hex')) returning id",
          [fill],
        )
      ).rows[0]!.id;
      const approval = (
        await pool.query<{ id: string }>(
          'insert into submit_approval(fill_task_id,fill_check_id,job_snapshot_id) values($1,$2,$3) returning id',
          [fill, check, snapshot],
        )
      ).rows[0]!.id;
      await pool.query('insert into run_job(run_id,job_id,title) values($1,$2,$3)', [
        runId,
        job,
        'Engineer',
      ]);
      return { job, snapshot, approval };
    };
    const a = await make(),
      b = await make();
    const submit = (x: typeof a) =>
      pool.query(
        `insert into application(job_id,job_snapshot_id,submit_approval_id,status,method)
      values($1,$2,$3,'to_verify','runner')`,
        [x.job, x.snapshot, x.approval],
      );
    const attempts = await Promise.allSettled([submit(a), submit(b)]);
    assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal((await loadRun(pool, id)).submissions, 1);
    await assert.rejects(submit(a));
    assert.equal((await loadRun(pool, id)).submissions, 1);
    assert.equal(
      (await pool.query('select count(*)::int as n from application where run_id=$1', [id])).rows[0]
        .n,
      1,
    );
    await assert.rejects(pool.query('update fill_task set run_id=null where run_id=$1', [id]));
    const secondId = await newRun({ submissionLimit: 2 });
    await pool.query("update search_run set status='ready',active_since=null where id=$1", [
      secondId,
    ]);
    const c = await make(secondId);
    await submit(c);
    await assert.rejects(submit(c));
    assert.equal((await loadRun(pool, secondId)).submissions, 1);
  });
});
