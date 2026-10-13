import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InterviewAnswer, InterviewSource } from '@jsa/shared';
import { checkInterviewAnswer, interviewTextAllowed } from './interview.ts';

const sources: InterviewSource[] = [
  { ref: 'J1', kind: 'job', text: 'Build APIs', fileId: null, sha256: null, factVersionIds: [] },
  {
    ref: 'M1',
    kind: 'material',
    text: 'Built an API',
    fileId: null,
    sha256: null,
    factVersionIds: [],
  },
];
const answer: InterviewAnswer = {
  technical: [{ text: 'How do you design APIs?', sources: ['J1'] }],
  projects: [{ text: 'What did you build?', sources: ['M1'] }],
  stories: [
    {
      title: 'API work',
      situation: null,
      task: null,
      action: 'Built an API',
      result: null,
      missing: ['What was the outcome?'],
      sources: ['M1'],
    },
  ],
  interviewer: [{ text: 'How does the team work?', sources: ['J1'] }],
};
test('valid practice keeps missing STAR parts, and invented refs or JD-only stories fail', () => {
  assert.deepEqual(checkInterviewAnswer(answer, sources), answer);
  assert.equal(
    checkInterviewAnswer({ ...answer, projects: [{ text: 'Hi', sources: ['M99'] }] }, sources),
    undefined,
  );
  assert.equal(
    checkInterviewAnswer(
      { ...answer, stories: [{ ...answer.stories[0], sources: ['J1'] }] },
      sources,
    ),
    undefined,
  );
  assert.equal(checkInterviewAnswer({ ...answer, technical: [] }, sources), undefined);
  assert.equal(checkInterviewAnswer({ ...answer, confirmed: true }, sources), undefined);
});
test('model text excludes contact details, personal profile text and sensitive form data', () => {
  for (const text of [
    'Email me@example.com',
    'Call +358 40 1234567',
    'My salary is 50000',
    'My work permit',
    'Test Person built APIs',
    'I live at Example Road 7',
  ]) {
    assert.equal(interviewTextAllowed(text, ['Test Person', 'Example Road 7']), false, text);
  }
  assert.equal(interviewTextAllowed('Built APIs in 2021-03 – 2024-06', ['', 'Test Person']), true);
});
