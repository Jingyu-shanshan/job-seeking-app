import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import https, { type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, describe, mock, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompanyResearch, CompanyResearchRequest, CompanyResearchState } from '@jsa/shared';
import { Pool } from 'pg';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { toolPriceUsd, toolUrls } from '../tools/provider.ts';
import { exportArchive } from '../export/export.ts';
import { unzip } from '../testing/zip.ts';
import { companyResearchRoutes, researchQuery, researchText } from './research.ts';

const input = { company: 'Example Co', website: 'https://example.com', topic: 'products' as const };
const content =
  'Our platform provides reliable payment services and billing tools for software teams. This is an official product description.';

test('research queries use only explicit company, official host and fixed topic', () => {
  assert.equal(researchQuery(input).query, '"Example Co" site:example.com products');
  assert.match(researchQuery({ ...input, topic: 'news' }).query, /news \d{4}$/);
  for (const company of [
    ' ',
    'x" OR private',
    'x\\y',
    'x\ny',
    'owner@example.com',
    'https://example.com',
  ])
    assert.throws(() => researchQuery({ ...input, company }));
  for (const website of [
    'http://example.com',
    'https://127.0.0.1',
    'https://example.com/private',
    'https://example.com/?token=private',
    'https://example.com/#private',
    'https://u:p@example.com',
    'https://linkedin.com',
  ])
    assert.throws(() => researchQuery({ ...input, website }));
  assert.throws(() => researchQuery({ ...input, company: 'x'.repeat(120) }));
});

test('research keeps literal source text, drops scripts and marks truncated excerpts', () => {
  const result = researchText(
    `<title>Products &amp; tools</title><nav>Nav</nav><main><p>${content}</p><script>send secrets</script></main>`,
  );
  assert.deepEqual(result, { title: 'Products & tools', text: content, truncated: false });
  assert.throws(() => researchText('<main>Empty shell</main>'));
  assert.equal(researchText(`<article>${'x'.repeat(20001)}</article>`).truncated, true);
  assert.equal(researchText(`<article>${'x'.repeat(20001)}</article>`).text.length, 20000);
});

describe('company research versions', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: FastifyInstance;
  let applicationId: string;
  let answer: () => Promise<Response>;
  let calls = 0;
  let searchSignal: AbortSignal | null | undefined;
  let reads: string[] = [];
  let pageMode = 'normal';
  const queryBodies: unknown[] = [];
  const result = (url: string) => ({
    url,
    title: 'Untrusted search title',
    snippet: 'Not page text',
    summary: 'Not page text',
    content: 'Not page text',
  });
  const body = (): CompanyResearchRequest => ({
    ...input,
    id: randomUUID(),
    maxCostUsd: toolPriceUsd,
  });
  const send = (payload: CompanyResearchRequest, id = applicationId) =>
    app.inject({ method: 'POST', url: `/applications/${id}/company-research`, payload });
  const versions = async () =>
    (
      await app.inject(`/applications/${applicationId}/company-research`)
    ).json<CompanyResearchState>().versions;
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    const job = (await pool.query('insert into job default values returning id')).rows[0];
    const snapshot = (
      await pool.query(
        `insert into job_snapshot(job_id,body,catalog_id,title,source_url) values($1,'Frozen private JD','paste','Engineer','https://example.com/jobs/1') returning id`,
        [job.id],
      )
    ).rows[0];
    applicationId = (
      await pool.query(
        `insert into application(job_id,job_snapshot_id,status,method,submitted_at) values($1,$2,'submitted','runner',now()) returning id`,
        [job.id, snapshot.id],
      )
    ).rows[0].id;
    await pool.query("update profile set name='Private Person',email='private@example.test'");
    const modelCall = (
      await pool.query(
        "insert into model_call(purpose,job_snapshot_id,model,started_at,duration_ms) values('interview',$1,'fake',now(),1) returning id",
        [snapshot.id],
      )
    ).rows[0];
    const prep = (
      await pool.query(
        "insert into interview_preparation(application_id,model_call_id,sources,answer) values($1,$2,'[]','{}') returning id",
        [applicationId, modelCall.id],
      )
    ).rows[0];
    await pool.query(
      "insert into interview_notes(preparation_id,body) values($1,'Private practice notes')",
      [prep.id],
    );
    answer = async () => Response.json({ results: [result('https://example.com/products')] });
    app = Fastify();
    app.register(companyResearchRoutes, {
      pool,
      deepseekApiKey: 'test-secret',
      fetch: async (url, init) => {
        assert.equal(String(url), toolUrls.search);
        assert.equal(init?.redirect, 'error');
        queryBodies.push(JSON.parse(String(init?.body)));
        calls++;
        searchSignal = init?.signal;
        return answer();
      },
    });
    mock.method(
      https,
      'get',
      (url: URL, options: RequestOptions, callback: (r: IncomingMessage) => void) => {
        reads.push(url.href);
        assert.equal(options.agent, false);
        assert.ok(options.lookup);
        assert.ok(options.signal);
        assert.equal(options.headers && 'authorization' in options.headers, false);
        const request = new EventEmitter() as EventEmitter & { destroy(error: Error): void };
        request.destroy = (error) => {
          request.emit('error', error);
        };
        queueMicrotask(() => {
          const response = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: object;
            destroy(): void;
          };
          response.destroy = () => {};
          response.statusCode = pageMode === 'redirect' ? 302 : 200;
          response.headers =
            pageMode === 'redirect'
              ? { location: 'https://other.example.com/private' }
              : { 'content-type': 'text/html' };
          callback(response as unknown as IncomingMessage);
          if (pageMode !== 'redirect') {
            response.emit(
              'data',
              Buffer.from(
                `<title>Official products</title><main>${pageMode === 'empty' ? '' : content}</main>`,
              ),
            );
            response.emit('end');
          }
        });
        return request;
      },
    );
    syncBuiltinESMExports();
  });
  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
    mock.restoreAll();
    syncBuiltinESMExports();
  });

  test('saves immutable evidence, deduplicates and restricts pages, keeps historical data and exports versions', async () => {
    const before = (await pool.query('select * from application')).rows;
    const snapshots = (await pool.query('select * from job_snapshot')).rows;
    const preparation = (await pool.query('select * from interview_preparation')).rows;
    const notes = (await pool.query('select * from interview_notes')).rows;
    answer = async () =>
      Response.json({
        results: [
          result('https://outside.test/products'),
          result('https://example.com/products#x'),
          result('https://example.com/products'),
          result('https://example.com/a'),
          result('https://example.com/b'),
          result('https://example.com/c'),
        ],
      });
    const payload = body();
    const response = await send(payload);
    assert.equal(response.statusCode, 201, response.body);
    const research = response.json<CompanyResearch>();
    assert.equal(research.status, 'completed');
    assert.equal(research.sources.length, 3);
    assert.equal(reads.length, 3);
    assert.equal(research.sources[0]!.text, content);
    assert.equal(research.sources[0]!.method, 'public_page');
    assert.ok(research.sources[0]!.readAt);
    assert.equal(research.costUsd, toolPriceUsd);
    assert.equal(research.estimated, false);
    assert.match(research.message, /recency.*unverified/);
    assert.ok(!JSON.stringify(queryBodies).includes('Private'));
    assert.ok(!JSON.stringify(queryBodies).includes('private@example'));
    assert.ok(!JSON.stringify(queryBodies).includes('Private practice notes'));
    assert.ok(!JSON.stringify(queryBodies).includes('Frozen private JD'));
    assert.equal((await send(payload)).statusCode, 200);
    assert.equal(calls, 1);
    assert.equal((await send({ ...payload, topic: 'news' })).statusCode, 409);
    assert.equal((await send(payload, randomUUID())).statusCode, 404);
    for (const change of [
      "update company_research set sources='[]'",
      "update company_research set company='Other'",
      'delete from company_research',
    ])
      await assert.rejects(
        pool.query(`${change} where id=$1`, [payload.id]),
        /immutable|cannot be deleted/,
      );
    assert.deepEqual((await pool.query('select * from application')).rows, before);
    assert.deepEqual((await pool.query('select * from job_snapshot')).rows, snapshots);
    assert.deepEqual((await pool.query('select * from interview_preparation')).rows, preparation);
    assert.deepEqual((await pool.query('select * from interview_notes')).rows, notes);
    assert.equal((await pool.query('select * from fact_version')).rowCount, 0);
    const exported = JSON.parse(
      unzip(await exportArchive(pool))
        .get('data.json')!
        .toString(),
    );
    assert.equal(exported.company_research[0].sources[0].text, content);
  });

  test('empty, rate-limited, invalid and unreachable outcomes retain prior versions and correct fees', async () => {
    const old = (await versions()).find((v) => v.status === 'completed')!;
    for (const [reply, fee, estimated] of [
      [async () => Response.json({ results: [] }), 0, false],
      [async () => new Response('', { status: 429 }), 0, false],
      [async () => Response.json({ bad: true }), toolPriceUsd, true],
      [
        async () => {
          throw new Error('timeout');
        },
        toolPriceUsd,
        true,
      ],
    ] as const) {
      answer = reply;
      const payload = body();
      const r = (await send(payload)).json<CompanyResearch>();
      assert.equal(r.status, 'failed');
      assert.equal(r.costUsd, fee);
      assert.equal(r.estimated, estimated);
      const count = calls;
      await send(payload);
      assert.equal(calls, count);
      assert.deepEqual(
        (await versions()).find((v) => v.id === old.id),
        old,
      );
    }
  });

  test('rejects insufficient budget and bad input before a reservation or provider call', async () => {
    const count = calls;
    for (const payload of [
      { ...body(), maxCostUsd: 0 },
      { ...body(), website: 'https://127.0.0.1' },
      { ...body(), company: 'owner@example.com' },
    ]) {
      const r = await send(payload);
      assert.ok([400, 409].includes(r.statusCode), r.body);
      assert.equal(
        (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
        0,
      );
      assert.equal(
        (await pool.query('select 1 from company_research where id=$1', [payload.id])).rowCount,
        0,
      );
    }
    assert.equal(calls, count);
  });

  test('same ID during an in-flight operation returns pending without another paid request', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    answer = async () => {
      entered();
      await waiting;
      return Response.json({ results: [] });
    };
    const payload = body();
    const first = send(payload);
    await started;
    try {
      const count = calls;
      assert.equal((await send(payload)).json<CompanyResearch>().status, 'pending');
      assert.equal(calls, count);
    } finally {
      release();
    }
    await first;
  });

  test('does not follow off-host redirects or replace unreadable content with search snippets', async () => {
    answer = async () => Response.json({ results: [result('https://example.com/news')] });
    for (const mode of ['redirect', 'empty']) {
      pageMode = mode;
      reads = [];
      const r = (await send(body())).json<CompanyResearch>();
      assert.equal(r.status, 'failed');
      assert.equal(r.sources.length, 0);
      assert.equal(r.issues.length, 1);
      assert.equal(reads.length, 1);
      assert.match(r.message, /unknown/);
    }
    pageMode = 'normal';
  });
  test('missing credentials never reserve money or create a research version', async () => {
    const noKey = Fastify();
    noKey.register(companyResearchRoutes, {
      pool,
      fetch: async () => {
        throw new Error('Unexpected network');
      },
    });
    try {
      const payload = body();
      const url = `/applications/${applicationId}/company-research`;
      assert.equal((await noKey.inject(url)).json<CompanyResearchState>().available, false);
      assert.equal((await noKey.inject({ method: 'POST', url, payload })).statusCode, 503);
      assert.equal(
        (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
        0,
      );
      assert.equal(
        (await pool.query('select 1 from company_research where id=$1', [payload.id])).rowCount,
        0,
      );
    } finally {
      await noKey.close();
    }
  });
  test('the operation deadline prevents page reads after the paid search, without a second charge', async () => {
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const timer = mock.method(AbortSignal, 'timeout', (ms: number) =>
      ms === 60000 ? deadline.signal : timeout(ms),
    );
    const count = calls;
    reads = [];
    answer = async () => {
      deadline.abort();
      return Response.json({ results: [result('https://example.com/products')] });
    };
    try {
      const payload = body();
      const r = (await send(payload)).json<CompanyResearch>();
      assert.equal(r.status, 'failed');
      assert.equal(r.sources.length, 0);
      assert.equal(r.costUsd, toolPriceUsd);
      assert.equal(reads.length, 0);
      assert.equal(searchSignal?.aborted, true);
      await send(payload);
      assert.equal(calls, count + 1);
    } finally {
      timer.mock.restore();
    }
  });
});
