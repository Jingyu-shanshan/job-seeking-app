import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type PdfItem, type PdfPage, pdfTextProblems } from './pdf.ts';

const pieces = [
  'Test Person',
  'test.person@example.com',
  'Helsinki',
  'Experience',
  'Backend developer, Acme Oy, 2021-03 – 2024-06',
  'Built the invoice API in Go; cut processing time by about 30%.',
];

/** A page with one item per line, each on its own line well inside an A4 page. */
function page(...lines: (string | Partial<PdfItem>)[]): PdfPage {
  return {
    width: 595,
    height: 842,
    items: lines.map((line, i) => ({
      x: 50,
      y: 780 - i * 16,
      width: 300,
      height: 11,
      eol: true,
      ...(typeof line === 'string' ? { text: line } : { text: '', ...line }),
    })),
  };
}

test('passes a PDF with exactly the document’s text', () => {
  assert.deepEqual(pdfTextProblems(pieces, [page(...pieces)]), []);
});

test('ignores where lines wrap, spaces, bullets and separators, and the page a line is on', () => {
  const wrapped = [
    page(
      'Test Person',
      'test.person@example.com · Helsinki',
      'Experience',
      { text: 'Backend developer, Acme Oy,', eol: false },
      { text: ' 2021-03 –\u00a02024-06', eol: true },
      '• Built the invoice API in Go; cut process-',
    ),
    page('ing time by about 30%.'),
  ];
  assert.deepEqual(pdfTextProblems(pieces, wrapped), [
    // A hyphen the browser added where it broke a word is text that is not in the document.
    '“Built the invoice API in Go; cut processing time by about 30%.” is not in the PDF, or reads differently there.',
    'The PDF has text that is not in the document: “• Built the invoice API in Go; cut process- ing time by about 30%.”.',
  ]);
  const broken = [
    page(...pieces.slice(0, 5), 'Built the invoice API in Go; cut process'),
    page('ing time by about 30%.'),
  ];
  assert.deepEqual(pdfTextProblems(pieces, broken), []);
});

test('reads ligatures and compatibility characters as the letters they stand for', () => {
  assert.deepEqual(pdfTextProblems(['office', 'one…'], [page('of\ufb01ce', 'one...')]), []);
});

test('finds a line that is missing or reads differently', () => {
  const changed = [
    ...pieces.slice(0, 5),
    'Built the invoice API in Go; cut processing time by about 31%.',
  ];
  assert.deepEqual(pdfTextProblems(pieces, [page(...changed)]), [
    '“Built the invoice API in Go; cut processing time by about 30%.” is not in the PDF, or reads differently there.',
    'The PDF has text that is not in the document: “Built the invoice API in Go; cut processing time by about 31%.”.',
  ]);
  assert.deepEqual(pdfTextProblems(pieces, [page(...pieces.slice(1))]), [
    '“Test Person” is not in the PDF, or reads differently there.',
  ]);
});

test('finds lines in the wrong order', () => {
  const swapped = [pieces[0]!, pieces[2]!, pieces[1]!, ...pieces.slice(3)];
  assert.deepEqual(pdfTextProblems(pieces, [page(...swapped)]), [
    '“Helsinki” is not in the PDF, or reads differently there.',
    'The PDF has text that is not in the document: “Helsinki”.',
  ]);
});

test('finds what a browser adds: the date, the page address and page numbers', () => {
  const printed = page(
    '06/10/2026, 14:02',
    ...pieces,
    'http://127.0.0.1:3000/drafts/1/document',
    '1/1',
  );
  assert.deepEqual(pdfTextProblems(pieces, [printed]), [
    'The PDF has text that is not in the document: “06/10/2026, 14:02”.',
    'The PDF has text that is not in the document: “http://127.0.0.1:3000/drafts/1/document 1/1”.',
  ]);
});

test('finds text that runs off a page', () => {
  const offRight = { text: pieces[5], x: 400, width: 300 };
  const right = [page(...pieces.slice(0, 3)), page(...pieces.slice(3, 5), offRight)];
  assert.deepEqual(pdfTextProblems(pieces, right), [
    'Text runs off page 2: “Built the invoice API in Go; cut processing time by about 30%.”.',
  ]);
  const below = page(...pieces.slice(0, 5), { text: pieces[5], y: -5 });
  assert.deepEqual(pdfTextProblems(pieces, [below]), [
    'Text runs off page 1: “Built the invoice API in Go; cut processing time by about 30%.”.',
  ]);
});

test('says when the PDF has no text at all, as when it was scanned', () => {
  assert.deepEqual(pdfTextProblems(pieces, [page({ text: ' ' })]), [
    'The PDF has no text the app can read. Print the page to PDF again; do not scan it.',
  ]);
});

test('lists at most eight problems of a kind', () => {
  const many = Array.from({ length: 12 }, (_, i) => `Line ${i}`);
  const problems = pdfTextProblems(many, [page('Something else entirely')]);
  assert.equal(problems.length, 10);
  assert.equal(problems[8], 'And 4 more like these.');
  assert.match(problems[9]!, /not in the document: “Something else entirely”/);
});
