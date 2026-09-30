import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { HealthResponseSchema } from './health.ts';

test('HealthResponseSchema accepts only { status: "ok" }', () => {
  assert.equal(Value.Check(HealthResponseSchema, { status: 'ok' }), true);
  assert.equal(Value.Check(HealthResponseSchema, { status: 'down' }), false);
  assert.equal(Value.Check(HealthResponseSchema, {}), false);
});
