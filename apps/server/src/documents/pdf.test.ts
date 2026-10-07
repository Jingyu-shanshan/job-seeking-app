import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pdfTextProblems } from '../rules/pdf.ts';
import { pdfOf } from '../testing/pdf.ts';
import { looksLikePdf, readPdf } from './pdf.ts';

test('reads the text of each page and where it sits', async () => {
  const read = await readPdf(
    pdfOf(['Test Pérson', 'Built (the) API'], [{ text: 'Page two', x: 100, y: 400 }]),
  );
  assert.ok(read.ok);
  assert.deepEqual(
    read.pages.map((page) => ({
      width: page.width,
      height: page.height,
      items: page.items.map(({ text, x, y, eol }) => ({ text, x, y, eol })),
    })),
    [
      {
        width: 595,
        height: 842,
        items: [
          { text: 'Test Pérson', x: 50, y: 782, eol: true },
          { text: 'Built (the) API', x: 50, y: 766, eol: false },
        ],
      },
      { width: 595, height: 842, items: [{ text: 'Page two', x: 100, y: 400, eol: false }] },
    ],
  );
  assert.ok(read.pages[0]!.items[0]!.width > 50);
});

test('says when a file is not a PDF it can read', async () => {
  assert.equal(looksLikePdf(pdfOf(['x'])), true);
  assert.equal(looksLikePdf(Buffer.from('<html>not a pdf</html>')), false);
  assert.deepEqual(await readPdf(Buffer.from('%PDF-1.4 and nothing else')), {
    ok: false,
    reason: 'The file could not be read as a PDF.',
  });
});

test('refuses more than 20 pages', async () => {
  const pages = Array.from({ length: 21 }, (_, i) => [`Page ${i + 1}`]);
  assert.deepEqual(await readPdf(pdfOf(...pages)), {
    ok: false,
    reason: 'The PDF has more than 20 pages.',
  });
});

test('reads a PDF that Chrome printed from the document page, made-up data', async () => {
  // Printed with headless Chrome 154 from the check server's document page on 2026-10-06, after
  // the user's details had a link too long for one line, which the page wrapped.
  const read = await readPdf(
    await readFile(new URL('../testing/chrome-resume.pdf', import.meta.url)),
  );
  assert.ok(read.ok);
  assert.equal(read.pages.length, 1);
  assert.deepEqual(
    [Math.round(read.pages[0]!.width), Math.round(read.pages[0]!.height)],
    [595, 842],
  );
  const pieces = [
    'Test Pérson',
    'Backend developer',
    'test.person@example.com',
    '+358 40 000 0000',
    'Helsinki',
    'github.com/test-person',
    'example.com/a-very-long-unbroken-path-segment-that-goes-on-and-on-and-on-without-any-break-at-all-to-test-wrapping',
    'Backend developer who built an invoice API in Go and PostgreSQL and cut its processing time by about 30%.',
    'Experience',
    'Backend developer, Acme Oy, Helsinki, 2021-03 – 2024-06',
    'Built the invoice API in Go and PostgreSQL; cut processing time by about 30%.',
    'Cut invoice processing time by about 30%.',
    'Moved nightly batch jobs to Kafka.',
    'Skills',
    'Go, PostgreSQL, Kafka, TypeScript',
    'Languages',
    'English (fluent)',
    'Finnish (basic, A2)',
  ];
  assert.deepEqual(pdfTextProblems(pieces, read.pages), []);
  const changed = pieces.map((piece) => piece.replace('basic, A2', 'basic, B1'));
  assert.deepEqual(pdfTextProblems(changed, read.pages), [
    '“Finnish (basic, B1)” is not in the PDF, or reads differently there.',
    'The PDF has text that is not in the document: “Finnish (basic, A2)”.',
  ]);
});
