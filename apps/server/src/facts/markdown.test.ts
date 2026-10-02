import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFactsMarkdown } from './markdown.ts';

test('reads one fact per list item or paragraph, with its kind from the heading', () => {
  const markdown = `---
title: Facts
---
# My facts

Backend developer who likes boring, reliable systems.

## Work experience
- Acme Oy, backend developer, 2021–2024
  - Built the invoice export
- Example Ltd, intern, 2020

## Skills
* TypeScript
* PostgreSQL

## Languages
1. Finnish (B1)
2. English (fluent)

## Hobbies
Sailing in the archipelago.
`;
  assert.deepEqual(
    parseFactsMarkdown(markdown).map((f) => [f.kind, f.body]),
    [
      ['other', 'Backend developer who likes boring, reliable systems.'],
      ['experience', 'Acme Oy, backend developer, 2021–2024\n- Built the invoice export'],
      ['experience', 'Example Ltd, intern, 2020'],
      ['skill', 'TypeScript'],
      ['skill', 'PostgreSQL'],
      ['language', 'Finnish (B1)'],
      ['language', 'English (fluent)'],
      ['other', 'Sailing in the archipelago.'],
    ],
  );
});

test('knows Chinese headings and keeps a paragraph after a list apart', () => {
  assert.deepEqual(
    parseFactsMarkdown('## 项目经历\n- 开票服务\n\n维护了三年。\n\n## 教育\n赫尔辛基大学').map(
      (f) => [f.kind, f.body],
    ),
    [
      ['project', '开票服务'],
      ['project', '维护了三年。'],
      ['education', '赫尔辛基大学'],
    ],
  );
});

test('finds nothing in a document of headings only', () => {
  assert.deepEqual(parseFactsMarkdown('# Facts\n\n## Skills\n'), []);
});
