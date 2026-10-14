import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { pdfOf } from '../testing/pdf.ts';
import { previewPdf } from './pdf.ts';

test('PDF preview keeps pages, digest, accents, dates, wrapped lines and recognised headings', async () => {
  const bytes = pdfOf(
    ['Skills', 'TypeScript and', 'PostgreSQL — 2021–2024'],
    ['Languages', 'Finnish (A2)'],
  );
  const preview = await previewPdf(bytes, 'sample.pdf');
  assert.deepEqual(
    preview.pages.map((p) => [p.page, p.text]),
    [
      [1, 'Skills\nTypeScript and\nPostgreSQL — 2021–2024'],
      [2, 'Languages\nFinnish (A2)'],
    ],
  );
  assert.deepEqual(
    preview.candidates.map((c) => [c.kind, c.body, c.source]),
    [
      [
        'skill',
        'TypeScript and\nPostgreSQL — 2021–2024',
        {
          type: 'pdf',
          fileName: 'sample.pdf',
          pages: [1],
          sha256: createHash('sha256').update(bytes).digest('hex'),
          edited: false,
        },
      ],
      [
        'language',
        'Finnish (A2)',
        {
          type: 'pdf',
          fileName: 'sample.pdf',
          pages: [2],
          sha256: createHash('sha256').update(bytes).digest('hex'),
          edited: false,
        },
      ],
    ],
  );
});

test('unknown text stays other, paragraphs and bullets separate, column fragments stay visible', async () => {
  const preview = await previewPdf(
    pdfOf([
      { text: 'Custom heading', x: 50, y: 780 },
      { text: 'Work sample', x: 50, y: 745 },
      { text: '2020 to 2024', x: 320, y: 745 },
      { text: '- Built an API', x: 50, y: 710 },
      { text: '- Tested it', x: 50, y: 695 },
    ]),
    'columns.pdf',
  );
  assert.ok(preview.candidates.every((c) => c.kind === 'other'));
  assert.deepEqual(
    preview.candidates.map((c) => c.body),
    ['Custom heading', 'Work sample 2020 to 2024', '- Built an API', '- Tested it'],
  );
});

test('refuses empty, non-PDF, broken, image-only and too many pages', async () => {
  for (const [bytes, expected] of [
    [Buffer.alloc(0), /empty/],
    [Buffer.from('pretend.pdf'), /not a PDF/],
    [Buffer.from('%PDF-1.4 broken'), /could not be read/],
    [pdfOf([]), /text layer/],
    [pdfOf(...Array.from({ length: 21 }, () => ['text'])), /more than 20 pages/],
  ] as const)
    await assert.rejects(previewPdf(bytes, 'test.pdf'), expected);
});

test('refuses excessive extracted text and candidate counts without truncation', async () => {
  const long = pdfOf(
    ...Array.from({ length: 20 }, () =>
      Array.from({ length: 600 }, () => ({ text: 'x'.repeat(20), x: 50, y: 400 })),
    ),
  );
  await assert.rejects(previewPdf(long, 'long.pdf'), /exceeds 200000/);
  const many = pdfOf(
    ...Array.from({ length: 5 }, (_, p) =>
      Array.from({ length: 41 }, (_, i) => `- item ${p}-${i}`),
    ),
  );
  await assert.rejects(previewPdf(many, 'many.pdf'), /at most 200 candidates/);
});

test('reads the existing real Chrome print fixture, without guessing personal fields', async () => {
  const preview = await previewPdf(
    await readFile(new URL('../testing/chrome-resume.pdf', import.meta.url)),
    'sample-resume.pdf',
  );
  assert.equal(preview.pages.length, 1);
  assert.match(preview.pages[0]!.text, /Test Pérson/);
  assert.ok(preview.candidates.some((c) => c.kind === 'skill' && c.body.includes('PostgreSQL')));
});

test('preserves Unicode text from a Chrome print and refuses the password-protected copy', async () => {
  const bytes = await readFile(new URL('../testing/facts-unicode.pdf', import.meta.url));
  const preview = await previewPdf(bytes, 'unicode.pdf');
  assert.match(preview.pages[0]!.text, /TypeScript、PostgreSQL；2021–2024，提升 30%。/);
  assert.ok(preview.candidates.some((c) => c.kind === 'skill' && c.body.includes('PostgreSQL')));
  assert.ok(preview.candidates.some((c) => c.kind === 'project' && c.body.includes('42 保持原⽂')));
  await assert.rejects(
    previewPdf(
      await readFile(new URL('../testing/facts-password.pdf', import.meta.url)),
      'password.pdf',
    ),
    /protected with a password/,
  );
});
