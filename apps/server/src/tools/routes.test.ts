import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { ToolCall, ToolCalls } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { toolPriceUsd } from './provider.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };

describe('manual web tools', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let sent = 0;
  let response: () => Promise<Response> = async () => Response.json({ results: [] });
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: '/nonexistent',
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      deepseekApiKey: 'private-key',
      fetch: async () => {
        sent++;
        return response();
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
  const request = (changes = {}) => ({
    id: randomUUID(),
    tool: 'search',
    input: 'Engineer site:example.com',
    maxCostUsd: toolPriceUsd,
    ...changes,
  });
  const post = (payload: ReturnType<typeof request>) =>
    call({ method: 'POST', url: '/api/tools', payload });

  test('private reads and writes require sign-in and trusted origin', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/tools' })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tools',
          headers: { cookie },
          payload: request(),
        })
      ).statusCode,
      403,
    );
    assert.equal(sent, 0);
  });
  test('opening the page only quotes costs and lists records', async () => {
    const before = sent;
    const res = await call({ method: 'GET', url: '/api/tools' });
    const body = res.json<ToolCalls>();
    assert.equal(res.statusCode, 200);
    assert.equal(body.available, true);
    assert.equal(body.estimatedCostUsd, toolPriceUsd);
    assert.equal(sent, before);
    assert.ok(!res.body.includes('private-key'));
  });
  test('input, restricted URLs and insufficient approved budget are refused before sending or reserving', async () => {
    const before = sent;
    for (const changes of [
      { input: ' ' },
      { input: 'x'.repeat(129) },
      { maxCostUsd: 0 },
      ...[
        'https://linkedin.com/jobs/view/1',
        'https://duunitori.fi/job',
        'https://jobly.fi/job',
        'http://example.com/job',
        'https://127.0.0.1/job',
        'https://user:pass@example.com/job',
        'https://example.com:444/job',
        'https://localhost/job',
      ].map((input) => ({ tool: 'fetch', input })),
    ]) {
      const payload = request(changes);
      const res = await post(payload);
      assert.ok([400, 409].includes(res.statusCode), res.body);
      assert.equal(
        (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
        0,
      );
    }
    assert.equal(sent, before);
  });
  test('a key is required and no reservation is created when missing', async () => {
    const withoutKey = buildApp({
      webRoot: '/nonexistent',
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
    });
    try {
      const payload = request();
      assert.equal(
        (
          await withoutKey.inject({
            method: 'POST',
            url: '/api/tools',
            headers: { cookie, origin: appUrl },
            payload,
          })
        ).statusCode,
        503,
      );
      assert.equal(
        (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
        0,
      );
    } finally {
      await withoutKey.close();
    }
  });
  test('concurrent duplicate operations reserve and send once, then return the saved result', async () => {
    const before = sent;
    response = async () =>
      Response.json({
        results: [
          {
            title: 'Engineer',
            url: 'https://example.com/job',
            snippet: 'Job',
            summary: 'A job',
            content: '',
          },
        ],
      });
    const payload = request();
    const replies = await Promise.all([post(payload), post(payload)]);
    assert.ok(replies.every((r) => r.statusCode === 200));
    assert.equal(sent, before + 1);
    const saved = (await post(payload)).json<ToolCall>();
    assert.equal(sent, before + 1);
    assert.equal(saved.costUsd, toolPriceUsd);
    assert.equal(saved.estimated, false);
    assert.ok(saved.result);
    assert.equal((await post({ ...payload, input: 'different' })).statusCode, 409);
    assert.equal(
      (await pool.query('select 1 from tool_call where id=$1', [payload.id])).rowCount,
      1,
    );
  });
  test('empty results and provider failures are recorded at zero, unknown outcomes keep their reservation without replay', async () => {
    for (const [answer, cost, estimated] of [
      [async () => Response.json({ results: [] }), 0, false],
      [async () => new Response('private-key', { status: 429 }), 0, false],
      [async () => Response.json({ invalid: true }), toolPriceUsd, true],
      [
        async () => {
          throw new Error('private-key');
        },
        toolPriceUsd,
        true,
      ],
    ] as const) {
      response = answer;
      const payload = request();
      const res = await post(payload);
      assert.equal(res.statusCode, 200, res.body);
      const saved = res.json<ToolCall>();
      assert.equal(saved.costUsd, cost);
      assert.equal(saved.estimated, estimated);
      assert.ok(!res.body.includes('private-key'));
      const before = sent;
      assert.deepEqual((await post(payload)).json(), saved);
      assert.equal(sent, before);
    }
  });
});
