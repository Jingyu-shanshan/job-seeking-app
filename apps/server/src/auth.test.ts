import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { buildApp } from './app.ts';
import { createAccount } from './auth.ts';
import { loadConfig } from './config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from './testing/database.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const origin = appUrl;
const secret = 'test-secret-that-is-at-least-32-characters';
const account = {
  email: 'owner@example.com',
  name: 'owner@example.com',
  password: 'correct horse battery staple',
};

describe('authentication', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;

  before(async () => {
    // Every migration, business and auth, on an empty database.
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
    });
    // Stand-ins for the data API, which later tasks add.
    app.get('/api/probe', async () => ({ ok: true }));
    app.post('/api/probe', async () => ({ ok: true }));
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  async function signIn(password = account.password) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin },
      payload: { email: account.email, password },
    });
  }

  /** The `cookie` header that carries the session set by `res`. */
  function sessionCookie(res: Awaited<ReturnType<typeof signIn>>) {
    const setCookie = [res.headers['set-cookie'] ?? []].flat();
    const session = setCookie.find((cookie) => cookie.startsWith('better-auth.session_token='));
    assert.ok(session, 'no session cookie');
    return session.split(';', 1)[0] as string;
  }

  test('the first account can sign in and use the API', async () => {
    const res = await signIn();
    assert.equal(res.statusCode, 200);
    const cookie = sessionCookie(res);
    assert.match(String(res.headers['set-cookie']), /HttpOnly/i);
    assert.match(String(res.headers['set-cookie']), /SameSite=Lax/i);

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().user.email, account.email);

    const probe = await app.inject({ method: 'GET', url: '/api/probe', headers: { cookie } });
    assert.equal(probe.statusCode, 200);
    const write = await app.inject({
      method: 'POST',
      url: '/api/probe',
      headers: { cookie, origin },
      payload: {},
    });
    assert.equal(write.statusCode, 200);
    // Signed in, an unknown API route is an ordinary 404.
    const unknown = await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } });
    assert.equal(unknown.statusCode, 404);
  });

  test('without a session the API refuses reads and writes', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/probe' })).statusCode, 401);
    const write = await app.inject({
      method: 'POST',
      url: '/api/probe',
      headers: { origin },
      payload: {},
    });
    assert.equal(write.statusCode, 401);
    const forged = await app.inject({
      method: 'GET',
      url: '/api/probe',
      headers: { cookie: 'better-auth.session_token=forged.value' },
    });
    assert.equal(forged.statusCode, 401);
  });

  test('a write from another origin, or without one, is refused even with a session', async () => {
    const cookie = sessionCookie(await signIn());
    for (const headers of [{ cookie, origin: 'https://evil.example' }, { cookie }]) {
      const res = await app.inject({ method: 'POST', url: '/api/probe', headers, payload: {} });
      assert.equal(res.statusCode, 403, JSON.stringify(headers));
    }
    // Sign-in from another site is refused too, so a page elsewhere cannot log the browser in.
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'https://evil.example' },
      payload: { email: account.email, password: account.password },
    });
    assert.equal(crossSite.statusCode, 403);
  });

  test('a wrong password is refused', async () => {
    const res = await signIn('not the password');
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('public sign-up is disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { email: 'someone@example.com', name: 'Someone', password: 'another long password' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'EMAIL_PASSWORD_SIGN_UP_DISABLED');
    const { rows } = await pool.query('select email from "user"');
    assert.deepEqual(rows, [{ email: account.email }]);
  });

  test('a second account cannot be created, not even directly in the database', async () => {
    await assert.rejects(
      createAccount(
        { pool, secret, appUrl, trustedOrigins },
        { ...account, email: 'second@example.com' },
      ),
      /exists already/,
    );
    await assert.rejects(
      pool.query(
        `insert into "user" (id, name, email, "emailVerified") values ('x', 'x', 'x@example.com', false)`,
      ),
      /user_single_account/,
    );
  });

  test('signing out ends the session', async () => {
    const cookie = sessionCookie(await signIn());
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin },
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const probe = await app.inject({ method: 'GET', url: '/api/probe', headers: { cookie } });
    assert.equal(probe.statusCode, 401);
  });

  test('a request body over 1 MiB is refused before Better Auth reads it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: account.email, password: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(res.statusCode, 413);
  });
});
