import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogEntry } from '@jsa/shared';
import { sourcesToRequest } from './sources.ts';

const entry = (id: string, access: CatalogEntry['access']): CatalogEntry => ({
  id,
  name: id,
  access,
  note: '',
  terms: null,
  rateLimit: null,
  param: null,
  alert: null,
});

const catalog = [
  entry('board', 'board_api'),
  entry('api', 'official_api'),
  entry('alert', 'email_alert'),
  entry('paste', 'manual'),
];

const ids = (sources: { source: { id: string } }[]) => sources.map(({ source }) => source.id);

test('requests only enabled sources', () => {
  const sources = [
    { id: 'on', catalogId: 'board', enabled: true },
    { id: 'off', catalogId: 'board', enabled: false },
    { id: 'api', catalogId: 'api', enabled: true },
  ];
  assert.deepEqual(ids(sourcesToRequest(sources, catalog)), ['on', 'api']);
});

test('never requests job-alert or paste sources, even when enabled', () => {
  const sources = [
    { id: 'alert', catalogId: 'alert', enabled: true },
    { id: 'paste', catalogId: 'paste', enabled: true },
  ];
  assert.deepEqual(sourcesToRequest(sources, catalog), []);
});

test('never requests a source whose catalog entry is gone', () => {
  assert.deepEqual(
    sourcesToRequest([{ id: 'x', catalogId: 'removed', enabled: true }], catalog),
    [],
  );
});

test('pairs each source with its catalog entry, for the rate limit', () => {
  const [first] = sourcesToRequest([{ id: 'on', catalogId: 'board', enabled: true }], catalog);
  assert.equal(first?.entry, catalog[0]);
});
