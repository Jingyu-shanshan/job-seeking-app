import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const productionDb = 'postgres://app:secret@db.example.com/jsa?sslmode=verify-full';
const production = { NODE_ENV: 'production', DATABASE_URL: productionDb };

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
    loadConfig({ DATABASE_URL: 'postgres://localhost/jsa' }).databaseUrl,
    'postgres://localhost/jsa',
  );
});

test('production requires DATABASE_URL with certificate verification', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL is required/);
  for (const query of ['', '?sslmode=require', '?sslmode=no-verify', '?sslmode=disable']) {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: `postgres://app:secret@db.example.com/jsa${query}`,
    };
    assert.throws(() => loadConfig(env), /sslmode=verify-full/, query);
  }
  assert.equal(loadConfig(production).databaseUrl, productionDb);
});

test('errors about DATABASE_URL do not repeat it', () => {
  for (const url of ['not a url, secret', 'postgres://app:secret@db.example.com/jsa']) {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: url }),
      (error: Error) => !error.message.includes('secret'),
    );
  }
});
