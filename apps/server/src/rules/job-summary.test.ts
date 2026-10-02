import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSummaryAnswer, summaryFieldKeys } from './job-summary.ts';

const text = `You will build our payment APIs.
- 3+ years of backend development
- Kubernetes is a plus
This role is based in Helsinki.`;

const nullFields = Object.fromEntries(summaryFieldKeys.map((key) => [key, null]));

test('marks each statement verified or not by its quote', () => {
  const checked = checkSummaryAnswer(text, {
    responsibilities: [
      { text: ' Build the payment APIs ', quote: 'You will build our payment APIs.' },
      { text: 'Lead the team', quote: 'You will lead the team.' },
    ],
    requirements: [
      { kind: 'must', text: '3+ years of backend', quote: '3+ years of backend development' },
      { kind: 'nice', text: 'Kubernetes', quote: 'Kubernetes is a plus' },
      { kind: 'must', text: 'A degree', quote: 'A degree in computer science' },
    ],
    fields: {
      ...nullFields,
      location: { value: 'Helsinki', quote: 'based in Helsinki.' },
      languages: { value: 'English', quote: 'We work in English.' },
    },
  });
  assert.deepEqual(checked, {
    responsibilities: [
      {
        text: 'Build the payment APIs',
        quote: 'You will build our payment APIs.',
        quoteVerified: true,
      },
      { text: 'Lead the team', quote: 'You will lead the team.', quoteVerified: false },
    ],
    requirements: [
      {
        text: '3+ years of backend',
        quote: '3+ years of backend development',
        quoteVerified: true,
        kind: 'must',
      },
      { text: 'Kubernetes', quote: 'Kubernetes is a plus', quoteVerified: true, kind: 'nice' },
      {
        text: 'A degree',
        quote: 'A degree in computer science',
        quoteVerified: false,
        kind: 'must',
      },
    ],
    fields: {
      ...nullFields,
      location: { value: 'Helsinki', quote: 'based in Helsinki.', quoteVerified: true },
      languages: { value: 'English', quote: 'We work in English.', quoteVerified: false },
    },
  });
});

test('keeps an unstated field unknown, whether the answer leaves it out, empty or null', () => {
  const checked = checkSummaryAnswer(text, {
    responsibilities: [],
    requirements: [{ kind: 'must', text: '  ', quote: 'Kubernetes is a plus' }],
    fields: { location: null, salary: { value: ' ', quote: 'x' } },
  });
  assert.deepEqual(checked, { responsibilities: [], requirements: [], fields: nullFields });
});

test('rejects an answer of another shape', () => {
  for (const answer of [
    null,
    'Helsinki',
    { responsibilities: [], requirements: [] },
    {
      responsibilities: [],
      requirements: [{ kind: 'required', text: 'x', quote: 'x' }],
      fields: {},
    },
    { responsibilities: [{ text: 'x' }], requirements: [], fields: {} },
    { responsibilities: [], requirements: [], fields: { location: 'Helsinki' } },
  ]) {
    assert.equal(checkSummaryAnswer(text, answer), undefined, JSON.stringify(answer));
  }
});
