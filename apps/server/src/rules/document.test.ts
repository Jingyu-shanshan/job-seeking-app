import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DraftLine, DraftSection, DraftStatement, Profile } from '@jsa/shared';
import {
  documentBlocks,
  documentFileName,
  documentMissing,
  documentPieces,
  linkText,
} from './document.ts';

let id = 0;
function statement(
  section: DraftSection,
  block: number,
  line: DraftLine,
  text: string,
  inDocument = true,
): DraftStatement {
  return {
    id: `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    section,
    block,
    line,
    about: section === 'letter' ? 'other' : 'me',
    text,
    modelText: text,
    edited: false,
    included: inDocument,
    quote: null,
    facts: [],
    problems: [],
    inDocument,
    verbatim: false,
  };
}

const profile: Profile = {
  name: 'Test Person',
  email: 'test.person@example.com',
  phone: '+358 40 000 0000',
  location: 'Helsinki',
  links: ['https://www.example.com/test-person/', 'https://github.com/test-person'],
};

const contact = {
  type: 'contact',
  items: [
    { text: 'test.person@example.com', href: 'mailto:test.person@example.com' },
    { text: '+358 40 000 0000', href: null },
    { text: 'Helsinki', href: null },
    { text: 'example.com/test-person', href: 'https://www.example.com/test-person/' },
    { text: 'github.com/test-person', href: 'https://github.com/test-person' },
  ],
} as const;

test('a resume: name, headline, contact details, summary, then each section with entries', () => {
  const resume = {
    kind: 'resume' as const,
    statements: [
      statement('headline', 0, 'sentence', 'Backend developer'),
      statement('summary', 0, 'sentence', 'Builds invoice APIs in Go.'),
      statement('summary', 0, 'sentence', 'Left out by a check.', false),
      statement('summary', 0, 'sentence', 'Cut processing time by about 30%.'),
      statement('experience', 0, 'title', 'Backend developer, Acme Oy, 2021-03 – 2024-06'),
      statement('experience', 0, 'bullet', 'Built the invoice API in Go.'),
      statement('experience', 0, 'bullet', 'Left out by the user.', false),
      statement('experience', 1, 'title', 'Left out, its bullets stay', false),
      statement('experience', 1, 'bullet', 'Ran the on-call rota.'),
      statement('projects', 0, 'title', 'Every statement of this section is left out', false),
      statement('skills', 0, 'title', 'Go, PostgreSQL, Kafka'),
      statement('skills', 1, 'title', 'Docker'),
      statement('languages', 0, 'title', 'Finnish: basic (A2)'),
    ],
  };
  const blocks = documentBlocks(resume, profile);
  assert.deepEqual(blocks, [
    { type: 'name', text: 'Test Person' },
    { type: 'headline', text: 'Backend developer' },
    contact,
    { type: 'paragraph', text: 'Builds invoice APIs in Go. Cut processing time by about 30%.' },
    { type: 'heading', text: 'Experience' },
    { type: 'entry', text: 'Backend developer, Acme Oy, 2021-03 – 2024-06' },
    { type: 'bullets', items: ['Built the invoice API in Go.'] },
    { type: 'bullets', items: ['Ran the on-call rota.'] },
    { type: 'heading', text: 'Skills' },
    { type: 'bullets', items: ['Go, PostgreSQL, Kafka', 'Docker'] },
    { type: 'heading', text: 'Languages' },
    { type: 'bullets', items: ['Finnish: basic (A2)'] },
  ]);
  assert.deepEqual(documentPieces(blocks), [
    'Test Person',
    'Backend developer',
    'test.person@example.com',
    '+358 40 000 0000',
    'Helsinki',
    'example.com/test-person',
    'github.com/test-person',
    'Builds invoice APIs in Go. Cut processing time by about 30%.',
    'Experience',
    'Backend developer, Acme Oy, 2021-03 – 2024-06',
    'Built the invoice API in Go.',
    'Ran the on-call rota.',
    'Skills',
    'Go, PostgreSQL, Kafka',
    'Docker',
    'Languages',
    'Finnish: basic (A2)',
  ]);
});

test('a cover letter: the app writes the greeting and the sign-off', () => {
  const letter = {
    kind: 'cover_letter' as const,
    statements: [
      statement('letter', 0, 'sentence', 'I am applying for the Payments Engineer role.'),
      statement('letter', 0, 'sentence', 'You move money for 40,000 merchants.'),
      statement('letter', 1, 'sentence', 'Every sentence of this paragraph is left out.', false),
      statement('letter', 2, 'sentence', 'I built an invoice API in Go.'),
    ],
  };
  assert.deepEqual(documentBlocks(letter, profile), [
    { type: 'name', text: 'Test Person' },
    contact,
    { type: 'paragraph', text: 'Dear Hiring Manager,' },
    {
      type: 'paragraph',
      text: 'I am applying for the Payments Engineer role. You move money for 40,000 merchants.',
    },
    { type: 'paragraph', text: 'I built an invoice API in Go.' },
    { type: 'closing', lines: ['Kind regards,', 'Test Person'] },
  ]);
});

test('only the details the user filled in appear', () => {
  const bare = { name: '', email: '', phone: '', location: '', links: [] };
  const letter = {
    kind: 'cover_letter' as const,
    statements: [statement('letter', 0, 'sentence', 'I am applying.')],
  };
  assert.deepEqual(documentBlocks(letter, bare), [
    { type: 'paragraph', text: 'Dear Hiring Manager,' },
    { type: 'paragraph', text: 'I am applying.' },
    { type: 'closing', lines: ['Kind regards,'] },
  ]);
  assert.deepEqual(documentBlocks({ kind: 'resume', statements: [] }, bare), []);
});

test('a PDF needs a name and at least one statement in the document', () => {
  const kept = { statements: [statement('summary', 0, 'sentence', 'Builds APIs.')] };
  const none = { statements: [statement('summary', 0, 'sentence', 'Builds APIs.', false)] };
  assert.deepEqual(documentMissing(kept, profile), []);
  assert.deepEqual(documentMissing(none, { name: '' }), [
    'Add your name on the Your details page.',
    'No statement is in the document.',
  ]);
});

test('links are shown without the scheme, www. or a trailing slash', () => {
  assert.equal(linkText('https://www.example.com/'), 'example.com');
  assert.equal(linkText('http://example.com/a/b'), 'example.com/a/b');
});

test('the file name says whose it is, what it is and which job it is for', () => {
  const job = { title: 'Payments Engineer / Backend', company: 'Example Pay: "Oy"' };
  assert.equal(
    documentFileName('cover_letter', job, profile),
    'Test Person - Cover letter - Example Pay Oy - Payments Engineer Backend',
  );
  assert.equal(
    documentFileName('resume', { title: 'Engineer', company: null }, { name: '' }),
    'Resume - Engineer',
  );
  assert.ok(
    documentFileName('resume', { title: 'x'.repeat(300), company: null }, profile).length <= 150,
  );
});
