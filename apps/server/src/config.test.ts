import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, loadDatabaseUrl } from './config.ts';

const productionDb = 'postgres://app:secret@db.example.com/jsa?sslmode=verify-full';
const authSecret = 'a-session-secret-of-at-least-32-chars';
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: productionDb,
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: 'https://jobs.example.com',
};

test('listens on loopback port 3000 by default', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
});

test('listens on 0.0.0.0 and the platform PORT in production', () => {
  const config = loadConfig({ ...production, PORT: '8080' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
});

test('HOST overrides the default', () => {
  assert.equal(loadConfig({ ...production, HOST: '127.0.0.1' }).host, '127.0.0.1');
});

test('rejects a PORT that is not a port number', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /Invalid PORT/);
});

test('DATABASE_URL is optional locally, and an empty value counts as unset', () => {
  assert.equal(loadConfig({}).databaseUrl, undefined);
  assert.equal(loadConfig({ DATABASE_URL: '' }).databaseUrl, undefined);
  assert.equal(
    loadConfig({ DATABASE_URL: 'postgres://localhost/jsa', BETTER_AUTH_SECRET: authSecret })
      .databaseUrl,
    'postgres://localhost/jsa',
  );
});

test('production requires DATABASE_URL with certificate verification', () => {
  assert.throws(
    () => loadConfig({ ...production, DATABASE_URL: undefined }),
    /DATABASE_URL is required/,
  );
  for (const query of ['', '?sslmode=require', '?sslmode=no-verify', '?sslmode=disable']) {
    const env = { ...production, DATABASE_URL: `postgres://app:secret@db.example.com/jsa${query}` };
    assert.throws(() => loadConfig(env), /sslmode=verify-full/, query);
  }
  assert.equal(loadConfig(production).databaseUrl, productionDb);
});

test('errors about DATABASE_URL do not repeat it', () => {
  for (const url of ['not a url, secret', 'postgres://app:secret@db.example.com/jsa']) {
    assert.throws(
      () => loadConfig({ ...production, DATABASE_URL: url }),
      (error: Error) => !error.message.includes('secret'),
    );
  }
});

test('locally the app is at 127.0.0.1 or localhost on its port, or behind ng serve', () => {
  assert.equal(loadConfig({}).appUrl, 'http://127.0.0.1:3000');
  assert.deepEqual(loadConfig({ PORT: '3100' }).trustedOrigins, [
    'http://127.0.0.1:3100',
    'http://localhost:3100',
    'http://localhost:4200',
  ]);
  assert.equal(
    loadConfig({ BETTER_AUTH_URL: 'http://localhost:3000/' }).appUrl,
    'http://localhost:3000',
  );
});

test('production requires an https BETTER_AUTH_URL and trusts only that origin', () => {
  assert.throws(
    () => loadConfig({ ...production, BETTER_AUTH_URL: undefined }),
    /BETTER_AUTH_URL is required/,
  );
  assert.throws(
    () => loadConfig({ ...production, BETTER_AUTH_URL: 'http://jobs.example.com' }),
    /https/,
  );
  const config = loadConfig(production);
  assert.equal(config.appUrl, 'https://jobs.example.com');
  assert.deepEqual(config.trustedOrigins, ['https://jobs.example.com']);
});

test('BETTER_AUTH_SECRET is required with a database and has at least 32 characters', () => {
  assert.equal(loadConfig({}).authSecret, undefined);
  const local = { DATABASE_URL: 'postgres://localhost/jsa' };
  assert.throws(() => loadConfig(local), /BETTER_AUTH_SECRET is required/);
  assert.throws(() => loadConfig({ ...production, BETTER_AUTH_SECRET: '' }), /required/);
  const short = 'short secret';
  assert.throws(
    () => loadConfig({ ...local, BETTER_AUTH_SECRET: short }),
    (error: Error) => /at least 32/.test(error.message) && !error.message.includes(short),
  );
  assert.equal(loadConfig({ ...local, BETTER_AUTH_SECRET: authSecret }).authSecret, authSecret);
});

test('migrations need only DATABASE_URL, with the same production check', () => {
  assert.equal(
    loadDatabaseUrl({ DATABASE_URL: 'postgres://localhost/jsa' }),
    'postgres://localhost/jsa',
  );
  assert.equal(
    loadDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: productionDb }),
    productionDb,
  );
  assert.throws(
    () =>
      loadDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db.example.com/jsa' }),
    /sslmode=verify-full/,
  );
});
