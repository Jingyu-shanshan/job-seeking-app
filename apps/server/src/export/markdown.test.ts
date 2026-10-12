import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFactsMarkdown } from '../facts/markdown.ts';
import { applicationsMarkdown, factsMarkdown } from './markdown.ts';

const at = new Date('2026-10-09T08:00:00Z');

test('exported facts import again with the same kinds and text', () => {
  const facts = [
    { kind: 'other' as const, body: 'Has a driving licence.' },
    {
      kind: 'experience' as const,
      body: 'Backend developer at Acme Oy\n\n# 2021–2024\n- Kept invoices correct',
    },
    { kind: 'skill' as const, body: 'TypeScript' },
    { kind: 'statement' as const, body: 'I build billing systems.' },
    { kind: 'language' as const, body: 'Finnish, B1' },
    { kind: 'certification' as const, body: 'AWS Solutions Architect' },
    { kind: 'education' as const, body: 'MSc, University of Helsinki' },
    { kind: 'project' as const, body: 'Invoice export service' },
  ];
  const markdown = factsMarkdown(facts, at);
  assert.match(markdown, /^---\nexported: 2026-10-09T08:00:00.000Z\n/);
  const back = parseFactsMarkdown(markdown);
  assert.deepEqual(
    back.map((f) => [f.kind, f.body]).sort(),
    facts.map((f) => [f.kind, f.body.replace('\n\n', '\n')]).sort(),
  );
});

test('no facts give only the front matter', () => {
  assert.deepEqual(parseFactsMarkdown(factsMarkdown([], at)), []);
});

test('a resolved failed application is not listed as awaiting verification', () => {
  const markdown = applicationsMarkdown(
    [
      {
        title: 'Backend developer',
        company: '',
        sourceUrl: null,
        status: 'not_submitted',
        method: 'runner',
        submittedAt: null,
        createdAt: at,
        note: '',
        files: [],
      },
    ],
    at,
  );
  assert.match(markdown, /Did not go through: the runner pressed Submit 2026-10-09 08:00 UTC/);
  assert.doesNotMatch(markdown, /Result unknown|Submitted/);
});

test('job text and filenames stay text instead of adding HTML or external Markdown links', () => {
  const markdown = applicationsMarkdown(
    [
      {
        title: '<img src="https://example.com/tracker">',
        company: '**Company**',
        sourceUrl: null,
        status: 'submitted',
        method: 'manual',
        submittedAt: at,
        createdAt: at,
        note: '[Read me](https://example.com)',
        files: [
          {
            label: 'Resume',
            fileName: 'a](https://example.com/unrelated).pdf',
            path: 'files/application_file/a.pdf',
            sha256: 'ab',
          },
        ],
      },
    ],
    at,
  );
  assert.ok(markdown.includes('\\<img src="https://example.com/tracker"\\>'));
  assert.ok(markdown.includes('\\*\\*Company\\*\\*'));
  assert.ok(markdown.includes('\\[Read me\\]\\(https://example.com\\)'));
  assert.ok(
    markdown.includes(
      '[a\\]\\(https://example.com/unrelated\\).pdf](<files/application_file/a.pdf>)',
    ),
  );
});

test('applications list status, how they went in and where each sent file is', () => {
  const markdown = applicationsMarkdown(
    [
      {
        title: 'Billing engineer',
        company: 'Example Oy',
        sourceUrl: 'https://example.com/jobs/1',
        status: 'submitted',
        method: 'manual',
        submittedAt: new Date('2026-09-20T08:30:00Z'),
        createdAt: new Date('2026-09-21T10:00:00Z'),
        note: 'Sent by email\nto the hiring manager.',
        files: [
          {
            label: '',
            fileName: 'My resume.pdf',
            path: 'files/application_file/a.pdf',
            sha256: 'ab',
          },
        ],
      },
      {
        title: 'Backend developer',
        company: '',
        sourceUrl: null,
        status: 'to_verify',
        method: 'runner',
        submittedAt: null,
        createdAt: new Date('2026-10-01T09:15:00Z'),
        note: '',
        files: [],
      },
    ],
    at,
  );
  assert.equal(
    markdown,
    [
      '---',
      'exported: 2026-10-09T08:00:00.000Z',
      '---',
      '',
      '# Applications',
      '',
      '## Billing engineer — Example Oy',
      '',
      '- Submitted 2026-09-20 08:30 UTC (recorded by you)',
      '- Job page: <https://example.com/jobs/1>',
      '- Note: Sent by email to the hiring manager.',
      '- Files sent:',
      '  - [My resume.pdf](<files/application_file/a.pdf>), SHA-256 ab',
      '',
      '## Backend developer',
      '',
      '- Result unknown, to verify: the runner pressed Submit 2026-10-01 09:15 UTC',
      '- No files kept for it.',
      '',
    ].join('\n'),
  );
  assert.match(applicationsMarkdown([], at), /No applications yet\.\n$/);
});
