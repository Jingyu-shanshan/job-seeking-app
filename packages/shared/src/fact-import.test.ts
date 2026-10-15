import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import type { Fact } from './facts.ts';
import { FactImportSourceSchema } from './facts.ts';
import { factDuplicates, factSourceLabel } from './fact-import.ts';

test('duplicates use current text, include withdrawn, and only selected earlier candidates block later ones', () => {
  const facts = [
    {
      id: 'a',
      current: { body: 'Current  skill', status: 'confirmed' },
      earlier: [{ body: 'Earlier skill', status: 'retired' }],
    },
    { id: 'b', current: { body: 'Withdrawn skill', status: 'retired' }, earlier: [] },
  ] as Fact[];
  assert.deepEqual(
    factDuplicates(
      [
        { body: 'Current\nskill', selected: true },
        { body: 'Withdrawn skill', selected: true },
        { body: 'Earlier skill', selected: true },
        { body: 'Earlier  skill', selected: true },
        { body: 'Other', selected: false },
        { body: 'Other', selected: true },
      ],
      facts,
    ),
    [
      { status: 'active', factId: 'a' },
      { status: 'retired', factId: 'b' },
      null,
      { status: 'batch', factId: null },
      null,
      null,
    ],
  );
});

test('source schemas bound file names, digests and unique page numbers', () => {
  const source = {
    type: 'pdf',
    fileName: 'sample.pdf',
    sha256: 'a'.repeat(64),
    pages: [1, 2],
    edited: false,
  };
  assert.equal(Value.Check(FactImportSourceSchema, source), true);
  for (const change of [
    { type: 'unknown' },
    { fileName: '' },
    { fileName: 'a'.repeat(256) },
    { fileName: 'line\nbreak' },
    { sha256: 'fake' },
    { pages: [0] },
    { pages: [21] },
    { pages: [1, 1] },
    { pages: [] },
    { edited: 'yes' },
  ])
    assert.equal(Value.Check(FactImportSourceSchema, { ...source, ...change }), false);
  assert.equal(
    Value.Check(FactImportSourceSchema, {
      type: 'markdown',
      fileName: '',
      sha256: source.sha256,
      edited: true,
    }),
    true,
  );
});

test('source labels show reviewed PDFs, page numbers and Markdown, without breaking older sources', () => {
  assert.equal(factSourceLabel('manual'), 'Manual entry');
  assert.equal(factSourceLabel('markdown'), 'Markdown import');
  assert.equal(
    factSourceLabel(
      JSON.stringify({ type: 'pdf', fileName: '履历.pdf', pages: [1, 2], edited: true }),
    ),
    'User-corrected PDF extraction: 履历.pdf, page 1, 2',
  );
  assert.equal(
    factSourceLabel(JSON.stringify({ type: 'markdown', fileName: '', edited: false })),
    'Markdown import: pasted text',
  );
  for (const source of ['test', 'null', '{}', '{broken'])
    assert.equal(factSourceLabel(source), source);
});
