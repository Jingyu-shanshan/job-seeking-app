import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentVersion,
  mayUse,
  sensitiveData,
  statusChangeAllowed,
  type VersionState,
} from './facts.ts';

const version = (fields: Partial<VersionState>): VersionState => ({
  version: 1,
  body: 'Maintained the invoice export service.',
  status: 'confirmed',
  maySendToModel: true,
  mayUseInMaterials: true,
  ...fields,
});

test('the current version is the newest one', () => {
  assert.equal(currentVersion([{ version: 1 }, { version: 3 }, { version: 2 }]).version, 3);
});

test('only a confirmed current version with the flag may be used', () => {
  assert.equal(mayUse([version({})], 'model'), true);
  assert.equal(mayUse([version({})], 'materials'), true);
  for (const status of ['proposed', 'retired'] as const) {
    assert.equal(mayUse([version({ status })], 'model'), false, status);
    assert.equal(mayUse([version({ status })], 'materials'), false, status);
  }
  assert.equal(mayUse([version({ maySendToModel: false })], 'model'), false);
  assert.equal(mayUse([version({ maySendToModel: false })], 'materials'), true);
  assert.equal(mayUse([version({ mayUseInMaterials: false })], 'materials'), false);
});

test('an edited fact is unusable until its new version is confirmed', () => {
  const edited = [version({}), version({ version: 2, status: 'proposed', body: 'New text.' })];
  assert.equal(mayUse(edited, 'model'), false);
  assert.equal(mayUse(edited, 'materials'), false);
});

test('a fact with contact details never goes to the model', () => {
  assert.equal(mayUse([version({ body: 'Reach me at me@example.com.' })], 'model'), false);
  assert.equal(mayUse([version({ body: 'Reach me at me@example.com.' })], 'materials'), true);
});

test('finds email addresses and phone numbers, not years or amounts', () => {
  assert.deepEqual(sensitiveData('Mail: maija.meikäläinen@example.fi'), ['an email address']);
  for (const text of ['+358 40 123 4567', 'Call 040-123 4567', '(555) 123-4567 ext']) {
    assert.deepEqual(sensitiveData(text), ['a phone number'], text);
  }
  for (const text of [
    'Worked there 2019-2023.',
    'Cut costs by 12 % for 3 000 users.',
    'Served 1,000,000 requests a day.',
    'Led a team of 8 in 2021–2024.',
    'Backend developer 2021-03 - 2024-06.',
    'From 2021.03-2024.06 and 2024-07-01.',
  ]) {
    assert.deepEqual(sensitiveData(text), [], text);
  }
});

test('a fact can be confirmed or withdrawn, and a withdrawn one confirmed again', () => {
  assert.equal(statusChangeAllowed('proposed', 'confirmed'), true);
  assert.equal(statusChangeAllowed('proposed', 'retired'), true);
  assert.equal(statusChangeAllowed('confirmed', 'retired'), true);
  assert.equal(statusChangeAllowed('retired', 'confirmed'), true);
  assert.equal(statusChangeAllowed('confirmed', 'proposed'), false);
  assert.equal(statusChangeAllowed('retired', 'proposed'), false);
  assert.equal(statusChangeAllowed('confirmed', 'confirmed'), true);
});
