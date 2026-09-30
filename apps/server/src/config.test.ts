import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

test('listens on loopback port 3000 by default', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
});

test('listens on 0.0.0.0 and the platform PORT in production', () => {
  const config = loadConfig({ NODE_ENV: 'production', PORT: '8080' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
});

test('HOST overrides the default', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1' }).host, '127.0.0.1');
});

test('rejects a PORT that is not a port number', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /Invalid PORT/);
});
