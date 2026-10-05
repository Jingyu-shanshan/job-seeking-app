import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDraftAnswer } from './draft.ts';

const factRefs = ['F1', 'F2', 'F3'];

test('flattens a resume into statements in document order', () => {
  const statements = checkDraftAnswer(
    'resume',
    {
      headline: { text: ' Backend developer ', facts: ['F1'] },
      summary: [
        { text: 'Builds invoice APIs in Go.', facts: ['F1', 'F2', 'F1'] },
        { text: '   ', facts: ['F1'] },
      ],
      experience: [
        {
          title: { text: 'Backend developer, Acme Oy', facts: ['F1'] },
          bullets: [
            { text: 'Built the invoice API.', facts: ['F2', 'F9'] },
            { text: 'Led five developers.', facts: [] },
          ],
        },
      ],
      skills: [{ title: { text: 'Go, PostgreSQL', facts: ['F3'] }, bullets: [] }],
      // Sections it leaves out are empty.
    },
    factRefs,
  );
  assert.deepEqual(statements, [
    {
      section: 'headline',
      block: 0,
      line: 'sentence',
      about: 'me',
      text: 'Backend developer',
      facts: ['F1'],
      unsentRefs: [],
      quote: null,
    },
    {
      section: 'summary',
      block: 0,
      line: 'sentence',
      about: 'me',
      text: 'Builds invoice APIs in Go.',
      facts: ['F1', 'F2'],
      unsentRefs: [],
      quote: null,
    },
    {
      section: 'experience',
      block: 0,
      line: 'title',
      about: 'me',
      text: 'Backend developer, Acme Oy',
      facts: ['F1'],
      unsentRefs: [],
      quote: null,
    },
    {
      section: 'experience',
      block: 0,
      line: 'bullet',
      about: 'me',
      text: 'Built the invoice API.',
      facts: ['F2'],
      unsentRefs: ['F9'],
      quote: null,
    },
    {
      section: 'experience',
      block: 0,
      line: 'bullet',
      about: 'me',
      text: 'Led five developers.',
      facts: [],
      unsentRefs: [],
      quote: null,
    },
    {
      section: 'skills',
      block: 0,
      line: 'title',
      about: 'me',
      text: 'Go, PostgreSQL',
      facts: ['F3'],
      unsentRefs: [],
      quote: null,
    },
  ]);
});

test('flattens a cover letter into paragraphs of statements', () => {
  const statements = checkDraftAnswer(
    'cover_letter',
    {
      paragraphs: [
        [
          { about: 'other', text: 'I am applying for the role.', facts: ['F1'] },
          { about: 'job', text: 'You build payment APIs.', quote: ' We build payment APIs. ' },
        ],
        [{ about: 'job', text: '  ', quote: 'x' }],
        [
          { about: 'me', text: 'I built invoice APIs.', facts: ['F2'], quote: 'ignored' },
          { about: 'job', text: 'You use Go.', quote: '' },
        ],
      ],
    },
    factRefs,
  );
  assert.deepEqual(
    statements?.map(({ block, about, text, facts, quote }) => ({
      block,
      about,
      text,
      facts,
      quote,
    })),
    [
      // A connecting sentence cites nothing, whatever the answer says.
      { block: 0, about: 'other', text: 'I am applying for the role.', facts: [], quote: null },
      {
        block: 0,
        about: 'job',
        text: 'You build payment APIs.',
        facts: [],
        quote: 'We build payment APIs.',
      },
      // The empty paragraph is gone, so this is the second one.
      { block: 1, about: 'me', text: 'I built invoice APIs.', facts: ['F2'], quote: null },
      { block: 1, about: 'job', text: 'You use Go.', facts: [], quote: null },
    ],
  );
  assert.ok(statements?.every((s) => s.section === 'letter' && s.line === 'sentence'));
});

test('refuses answers without the expected shape', () => {
  for (const answer of [
    null,
    'text',
    { summary: [] },
    { headline: null, summary: [{ text: 'x' }] },
    { headline: null, summary: [], experience: [{ title: { text: 'x', facts: [] } }] },
    { headline: null, summary: [], skills: [{ title: { text: 'x', facts: [1] }, bullets: [] }] },
  ]) {
    assert.equal(checkDraftAnswer('resume', answer, factRefs), undefined, JSON.stringify(answer));
  }
  for (const answer of [
    { paragraphs: [[{ text: 'x' }]] },
    { paragraphs: [[{ about: 'company', text: 'x' }]] },
    { paragraphs: 'x' },
  ]) {
    assert.equal(
      checkDraftAnswer('cover_letter', answer, factRefs),
      undefined,
      JSON.stringify(answer),
    );
  }
});
