import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createTestDatabase, needsDatabase } from './testing/database.ts';

// The local defaults: the app at http://127.0.0.1:3000, no database.
const { appUrl, trustedOrigins } = loadConfig({});

describe('with a web build', () => {
  let webRoot: string;
  let app: ReturnType<typeof buildApp>;

  before(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'jsa-web-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><app-root></app-root>');
    writeFileSync(join(webRoot, 'main.js'), 'console.log("app")');
    app = buildApp({ webRoot, appUrl, trustedOrigins });
  });

  after(async () => {
    await app.close();
    rmSync(webRoot, { recursive: true });
  });

  test('GET /health reports the process is up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });

  test('serves the home page and its assets', async () => {
    const home = await app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.headers['content-type'] as string, /text\/html/);
    assert.match(home.body, /<app-root>/);

    const asset = await app.inject({ method: 'GET', url: '/main.js' });
    assert.equal(asset.statusCode, 200);
    assert.match(asset.headers['content-type'] as string, /javascript/);
  });

  test('a deep Angular route returns the app shell, also with a query string', async () => {
    for (const url of ['/jobs/123', '/jobs/123?tab=match']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.body, /<app-root>/, url);
    }
  });

  test('an API route, also an unknown one, is a JSON 401 without a session, not the app shell', async () => {
    for (const url of ['/api', '/api/nope', '/api/jobs/123']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 401, url);
      assert.deepEqual(res.json(), { error: 'Unauthorized' }, url);
    }
  });

  test('a missing asset is a 404, not the app shell', async () => {
    const res = await app.inject({ method: 'GET', url: '/missing.js' });
    assert.equal(res.statusCode, 404);
  });

  test('only GET falls back to the app shell', async () => {
    const res = await app.inject({ method: 'POST', url: '/jobs/123' });
    assert.equal(res.statusCode, 404);
  });
});

describe('without a web build', () => {
  test('the API still answers and pages are 404', async () => {
    const app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      appUrl,
      trustedOrigins,
    });
    try {
      assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/jobs/123' })).statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

describe('/health/ready', () => {
  const webRoot = join(tmpdir(), 'jsa-web-does-not-exist');

  test('is 503 without a database', async () => {
    const app = buildApp({ webRoot, appUrl, trustedOrigins });
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.json(), { status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  test('is 503 when the database is unreachable, while /health stays 200', async () => {
    const app = buildApp({
      webRoot,
      appUrl,
      trustedOrigins,
      databaseUrl: 'postgres://postgres:postgres@127.0.0.1:1/postgres',
      authSecret: 'test-secret-that-is-at-least-32-characters',
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.json(), { status: 'unavailable' });
      assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    } finally {
      await app.close();
    }
  });

  test('is 200 when the database answers', needsDatabase, async () => {
    const db = await createTestDatabase({ migrated: false });
    const app = buildApp({
      webRoot,
      appUrl,
      trustedOrigins,
      databaseUrl: db.url,
      authSecret: 'test-secret-that-is-at-least-32-characters',
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { status: 'ok' });
    } finally {
      await app.close();
      await db.drop();
    }
  });
});
