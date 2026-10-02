import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Source, SourcesResponse } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { catalog } from './catalog.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };

describe('/api/sources', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
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

  const listSources = async () => {
    const res = await call({ method: 'GET', url: '/api/sources' });
    assert.equal(res.statusCode, 200);
    return res.json<SourcesResponse>();
  };

  const addSource = (catalogId: string, param?: string) =>
    call({ method: 'POST', url: '/api/sources', payload: { catalogId, param } });

  test('lists the whole catalog, and no sources until the user adds one', async () => {
    const body = await listSources();
    assert.deepEqual(body.catalog, catalog);
    assert.deepEqual(body.sources, []);
  });

  test('adds a job board, enabled and not yet run, and only once', async () => {
    const res = await addSource('greenhouse_board', ' acme ');
    assert.equal(res.statusCode, 201);
    const source = res.json<Source>();
    assert.deepEqual(
      { ...source, id: undefined },
      {
        id: undefined,
        catalogId: 'greenhouse_board',
        param: 'acme',
        enabled: true,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
      },
    );
    assert.ok((await listSources()).sources.some((s) => s.id === source.id));

    const again = await addSource('greenhouse_board', 'acme');
    assert.equal(again.statusCode, 409);
    assert.match(again.json().message, /already been added/);
    // The same board name on another provider is another source.
    assert.equal((await addSource('ashby_board', 'acme')).statusCode, 201);
  });

  test('rejects a board name that is missing or not a name', async () => {
    for (const param of [undefined, '', 'https://job-boards.greenhouse.io/acme', 'acme/jobs']) {
      const res = await addSource('greenhouse_board', param);
      assert.equal(res.statusCode, 400, String(param));
      assert.match(res.json().message, /Board name is not valid/);
    }
  });

  test('adds a job-alert entry once and without a parameter', async () => {
    assert.equal((await addSource('linkedin_alert', 'x')).statusCode, 400);
    assert.equal((await addSource('linkedin_alert')).statusCode, 201);
    assert.equal((await addSource('linkedin_alert')).statusCode, 409);
  });

  test('does not add pasting, which is always available, or an unknown entry', async () => {
    assert.equal((await addSource('paste')).statusCode, 400);
    assert.equal((await addSource('whole_web')).statusCode, 400);
    assert.equal((await listSources()).sources.filter((s) => s.catalogId === 'paste').length, 0);
  });

  test('disables and enables a source', async () => {
    const { id } = (await addSource('greenhouse_board', 'toggle')).json<Source>();
    const patch = (enabled: boolean) =>
      call({ method: 'PATCH', url: `/api/sources/${id}`, payload: { enabled } });

    assert.equal((await patch(false)).json<Source>().enabled, false);
    const listed = (await listSources()).sources.find((s) => s.id === id);
    assert.equal(listed?.enabled, false);
    assert.equal((await patch(true)).json<Source>().enabled, true);
  });

  test('removes a source', async () => {
    const { id } = (await addSource('greenhouse_board', 'typo')).json<Source>();
    const remove = () => call({ method: 'DELETE', url: `/api/sources/${id}` });
    assert.equal((await remove()).statusCode, 204);
    assert.equal((await remove()).statusCode, 404);
    assert.ok(!(await listSources()).sources.some((s) => s.id === id));
  });

  test('answers 404 for an unknown source and 400 for an id that is not one', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const [url, status] of [
      [`/api/sources/${unknown}`, 404],
      ['/api/sources/not-a-uuid', 400],
    ] as const) {
      const patch = await call({ method: 'PATCH', url, payload: { enabled: false } });
      assert.equal(patch.statusCode, status, url);
      assert.equal((await call({ method: 'DELETE', url })).statusCode, status, url);
    }
  });

  test('shows when a source last succeeded and why it last failed', async () => {
    const { id } = (await addSource('ashby_board', 'status')).json<Source>();
    await pool.query(
      `update source set last_success_at = '2026-09-30T08:00:00Z',
         last_failure_at = '2026-10-01T08:00:00Z', last_failure_reason = 'HTTP 404: no such board'
       where id = $1`,
      [id],
    );
    const listed = (await listSources()).sources.find((s) => s.id === id);
    assert.equal(listed?.lastSuccessAt, '2026-09-30T08:00:00.000Z');
    assert.equal(listed?.lastFailureAt, '2026-10-01T08:00:00.000Z');
    assert.equal(listed?.lastFailureReason, 'HTTP 404: no such board');
  });

  test('hides a source whose catalog entry has been removed', async () => {
    await pool.query(`insert into source (catalog_id, param) values ('retired_board', 'acme')`);
    const { sources } = await listSources();
    assert.ok(!sources.some((s) => s.catalogId === 'retired_board'));
  });

  test('refuses a request without a session, and a write from another site', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/sources' })).statusCode, 401);
    const res = await call({
      method: 'POST',
      url: '/api/sources',
      headers: { origin: 'https://evil.example' },
      payload: { catalogId: 'greenhouse_board', param: 'evil' },
    });
    assert.equal(res.statusCode, 403);
    assert.ok(!(await listSources()).sources.some((s) => s.param === 'evil'));
  });
});
