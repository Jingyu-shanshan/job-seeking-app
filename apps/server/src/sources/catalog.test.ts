import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogEntrySchema } from '@jsa/shared';
import { Value } from 'typebox/value';
import { catalog, findCatalogEntry } from './catalog.ts';

const requesting = catalog.filter((e) => e.access === 'board_api' || e.access === 'official_api');

test('every entry matches the schema and has a unique id the database accepts', () => {
  for (const entry of catalog) {
    assert.ok(Value.Check(CatalogEntrySchema, entry), entry.id);
    assert.match(entry.id, /^[a-z0-9_]+$/, entry.id);
  }
  assert.equal(new Set(catalog.map((e) => e.id)).size, catalog.length);
});

test('every site the app requests was checked, and every check has a past date and an https page', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of catalog) {
    if (entry.access === 'manual') continue;
    // A job-alert source's site is never requested; its emails are the user's own.
    if (entry.access === 'email_alert' && !entry.terms) continue;
    assert.ok(entry.terms, entry.id);
    assert.match(entry.terms.checkedOn, /^\d{4}-\d{2}-\d{2}$/, entry.id);
    assert.ok(entry.terms.checkedOn <= today, entry.id);
    assert.match(entry.terms.url, /^https:\/\//, entry.id);
  }
});

test('only entries the app requests have a rate limit, and all of them do', () => {
  assert.ok(requesting.length > 0);
  for (const entry of catalog) {
    assert.equal(entry.rateLimit !== null, requesting.includes(entry), entry.id);
  }
});

test('a job board entry always names one board, so no entry searches everything', () => {
  for (const entry of catalog.filter((e) => e.access === 'board_api')) {
    assert.ok(entry.param, entry.id);
    const pattern = new RegExp(entry.param.pattern);
    assert.ok(pattern.test('acme'), entry.id);
    assert.ok(pattern.test('Acme-Labs_2.0'), entry.id);
    for (const wrong of ['', ' acme', 'https://example.com/acme', 'acme/jobs', '*', '%']) {
      assert.ok(!pattern.test(wrong), `${entry.id} accepts ${JSON.stringify(wrong)}`);
    }
  }
});

test('sites the app does not request explain why, and pasting and saving are always there', () => {
  for (const entry of catalog.filter((e) => e.access === 'email_alert')) {
    assert.ok(entry.note.length > 40, entry.id);
    assert.equal(entry.param, null, entry.id);
    assert.ok(entry.alert && entry.alert.senders.length > 0, entry.id);
  }
  for (const entry of catalog.filter((e) => e.access !== 'email_alert')) {
    assert.equal(entry.alert, null, entry.id);
  }
  assert.equal(findCatalogEntry('paste')?.access, 'manual');
  assert.equal(findCatalogEntry('desktop_save')?.access, 'manual');
  assert.equal(findCatalogEntry('nope'), undefined);
});
