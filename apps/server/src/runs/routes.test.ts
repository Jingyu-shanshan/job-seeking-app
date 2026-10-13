import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, describe, test } from 'node:test';
import type { Run, RunConfig, RunPreset } from '@jsa/shared';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
const { appUrl, trustedOrigins } = loadConfig({});
const config: RunConfig = {
  name: 'Discovery only',
  discoveryLimit: 1,
  materialLimit: 0,
  submissionLimit: 0,
  requestLimit: 2,
  timeLimitSeconds: 30,
  costLimitUsd: 0,
  intervalHours: 0,
};
const secret = 'test-secret-that-is-at-least-32-characters';

describe('run API and background scheduler', needsDatabase, () => {
  let db: TestDatabase, pool: Pool, app: ReturnType<typeof buildApp>, cookie: string;
  const board = fakeGreenhouse({ sample: [{ id: 7, title: 'Engineer', location: 'Helsinki' }] });
  const startApp = () =>
    buildApp({
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      webRoot: join(tmpdir(), 'no-run-test-web'),
      fetch: board.fetch,
    });
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = startApp();
    const account = {
      email: 'owner@example.com',
      name: 'Sample owner',
      password: 'correct horse battery',
    };
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: account,
    });
    cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  });
  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie, origin: appUrl } });
  const waitRun = async (id: string, status: Run['status']) => {
    for (let i = 0; i < 150; i++) {
      const r = (await call('GET', '/api/runs/' + id)).json<Run>();
      if (r.status === status) return r;
      await sleep(20);
    }
    assert.fail('run did not reach ' + status);
  };
  test('requires a session, trusted Origin, and bounded preset values', async () => {
    assert.equal((await app.inject({ url: '/api/runs' })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/run-presets',
          headers: { cookie, origin: 'https://evil.example' },
          payload: config,
        })
      ).statusCode,
      403,
    );
    for (const override of [
      { requestLimit: 0 },
      { costLimitUsd: -1 },
      { submissionLimit: 6 },
      { materialLimit: 1.5 },
      { intervalHours: 169 },
    ]) {
      assert.equal(
        (await call('POST', '/api/run-presets', { ...config, ...override })).statusCode,
        400,
      );
    }
  });
  test('runs asynchronously, exposes the captured config, and resume keeps request counts', async () => {
    await pool.query(
      "insert into source(catalog_id,param,enabled) values('greenhouse_board','sample',true)",
    );
    const preset = (await call('POST', '/api/run-presets', config)).json<RunPreset>();
    const response = await call('POST', '/api/runs', { presetId: preset.id });
    assert.equal(response.statusCode, 202);
    const run = await waitRun(response.json<Run>().id, 'ready');
    assert.equal(run.jobs.length, 1);
    assert.equal(run.requests, 1);
    await call('PUT', '/api/run-presets/' + preset.id, { ...config, requestLimit: 10 });
    assert.equal((await call('GET', '/api/runs/' + run.id)).json<Run>().config.requestLimit, 2);
    assert.equal(
      (await call('POST', '/api/runs/' + run.id + '/stop', {})).json<Run>().status,
      'paused',
    );
    assert.equal((await call('POST', '/api/runs/' + run.id + '/resume', {})).statusCode, 202);
    const resumed = await waitRun(run.id, 'ready');
    assert.equal(resumed.requests, 1);
  });
  test('a server restart pauses interrupted work without resetting budget', async () => {
    await app.close();
    const preset = (await pool.query<{ id: string }>('select id from run_preset limit 1')).rows[0]!
      .id;
    const run = (
      await pool.query<{
        id: string;
      }>(`insert into search_run(preset_id,config,criteria,sources,status,active_since,requests,cost_usd)
      select preset_id,config,criteria,sources,'running',now()-interval '2 seconds',1,0.01 from search_run limit 1 returning id`)
    ).rows[0]!.id;
    assert.ok(preset);
    app = startApp();
    await app.ready();
    const paused = await waitRun(run, 'paused');
    assert.equal(paused.requests, 1);
    assert.equal(paused.costUsd, 0.01);
    assert.ok(paused.elapsedSeconds >= 2);
  });
  test('a scheduled run only discovers and prepares; a paused preset is not rerun', async () => {
    const preset = (
      await call('POST', '/api/run-presets', { ...config, intervalHours: 1 })
    ).json<RunPreset>();
    await pool.query("update run_preset set next_at=now()-interval '1 second' where id=$1", [
      preset.id,
    ]);
    await app.close();
    app = startApp();
    await app.ready();
    let scheduled: string | undefined;
    for (let i = 0; i < 100; i++) {
      scheduled = (
        await pool.query<{ id: string }>('select id from search_run where preset_id=$1', [
          preset.id,
        ])
      ).rows[0]?.id;
      if (scheduled) break;
      await sleep(20);
    }
    assert.ok(scheduled);
    await waitRun(scheduled, 'ready');
    assert.equal((await pool.query('select count(*)::int as n from application')).rows[0].n, 0);
    assert.equal((await pool.query('select count(*)::int as n from submit_approval')).rows[0].n, 0);
    await call('POST', '/api/runs/' + scheduled + '/stop', {});
    await pool.query("update run_preset set next_at=now()-interval '1 second' where id=$1", [
      preset.id,
    ]);
    await sleep(1200);
    assert.equal(
      (
        await pool.query('select count(*)::int as n from search_run where preset_id=$1', [
          preset.id,
        ])
      ).rows[0].n,
      1,
    );
  });
});
