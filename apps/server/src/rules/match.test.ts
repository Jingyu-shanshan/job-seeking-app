import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type MustHavesInput,
  checkMatchAnswer,
  evidenceVerdict,
  matchOutdated,
  mustHavesOutcome,
  outcomeNow,
} from './match.ts';

const requirementRefs = ['R1', 'R2', 'R3'];
const factRefs = ['F1', 'F2'];

test('keeps one checked outcome per requirement sent, in the order sent', () => {
  assert.deepEqual(
    checkMatchAnswer(
      {
        requirements: [
          {
            ref: 'R2',
            outcome: 'unmet',
            facts: ['F2'],
            note: ' Asks for five years; F2 says two. ',
          },
          { ref: 'R1', outcome: 'met', facts: ['F1', 'F2', 'F1'], note: 'F1 and F2 say so.' },
          { ref: 'R3', outcome: 'unknown', facts: [], note: 'No fact mentions Finnish.' },
        ],
      },
      requirementRefs,
      factRefs,
    ),
    [
      { outcome: 'met', facts: ['F1', 'F2'], note: 'F1 and F2 say so.' },
      { outcome: 'unmet', facts: ['F2'], note: 'Asks for five years; F2 says two.' },
      { outcome: 'unknown', facts: [], note: 'No fact mentions Finnish.' },
    ],
  );
});

test('an outcome resting on no fact that was sent is unknown', () => {
  const [r1, r2, r3] = checkMatchAnswer(
    {
      requirements: [
        { ref: 'R1', outcome: 'met', facts: [], note: 'They clearly can.' },
        { ref: 'R2', outcome: 'unmet', facts: ['F9'], note: 'F9 says otherwise.' },
        // Partly covered: the facts stay, the outcome stays unknown.
        { ref: 'R3', outcome: 'unknown', facts: ['F1', 'F7'], note: 'F1 covers part of it.' },
      ],
    },
    requirementRefs,
    factRefs,
  )!;
  assert.deepEqual(r1, {
    outcome: 'unknown',
    facts: [],
    note: 'DeepSeek said met but cited none of your facts, so it is unknown.',
  });
  assert.deepEqual([r2!.outcome, r2!.facts], ['unknown', []]);
  assert.deepEqual(r3, { outcome: 'unknown', facts: ['F1'], note: 'F1 covers part of it.' });
});

test('a requirement the answer skips is unknown; unknown or repeated refs are ignored', () => {
  const checked = checkMatchAnswer(
    {
      requirements: [
        { ref: 'R1', outcome: 'met', facts: ['F1'], note: 'First.' },
        { ref: 'R1', outcome: 'unmet', facts: ['F2'], note: 'Second.' },
        { ref: 'R9', outcome: 'met', facts: ['F1'], note: 'Not sent.' },
      ],
    },
    requirementRefs,
    factRefs,
  )!;
  assert.deepEqual(
    checked.map((c) => [c.outcome, c.note]),
    [
      ['met', 'First.'],
      ['unknown', 'DeepSeek gave no answer for this requirement.'],
      ['unknown', 'DeepSeek gave no answer for this requirement.'],
    ],
  );
});

test('refuses an answer of the wrong shape', () => {
  for (const answer of [
    null,
    [],
    { requirements: {} },
    { requirements: [{ ref: 'R1', outcome: 'partly', facts: [], note: '' }] },
    { requirements: [{ ref: 'R1', outcome: 'met', facts: 'F1', note: '' }] },
    { requirements: [{ ref: 'R1', outcome: 'met', facts: ['F1'] }] },
    { requirements: [{ ref: 'R1', outcome: 'met', facts: [], note: 'x'.repeat(1001) }] },
  ]) {
    assert.equal(checkMatchAnswer(answer, requirementRefs, factRefs), undefined);
  }
});

test('an outcome counts while the facts it cites are current and confirmed', () => {
  const valid = new Set(['v1', 'v2']);
  assert.equal(outcomeNow({ outcome: 'met', factVersionIds: ['v1', 'v2'] }, valid), 'met');
  assert.equal(outcomeNow({ outcome: 'unmet', factVersionIds: ['v1'] }, valid), 'unmet');
  assert.equal(outcomeNow({ outcome: 'met', factVersionIds: ['v1', 'old'] }, valid), 'unknown');
});

test('a match verdict: eligible when all must-haves were met, ineligible when one was not', () => {
  assert.equal(evidenceVerdict(['met', 'met']), 'eligible');
  assert.equal(evidenceVerdict([]), 'eligible');
  assert.equal(evidenceVerdict(['met', 'unknown']), 'to_confirm');
  assert.equal(evidenceVerdict(['unknown', 'unmet']), 'ineligible');
});

const must = (id: string, text = id) => ({ id, text, quote: `${text} quoted` });

const input = (fields: Partial<MustHavesInput> = {}): MustHavesInput => ({
  hasText: true,
  requirementsKnown: true,
  mustHaves: [must('go', 'Go'), must('sql', 'SQL')],
  matched: new Map([
    ['go', { outcome: 'met', factVersionIds: ['v1'] }],
    ['sql', { outcome: 'met', factVersionIds: ['v2'] }],
  ]),
  validFactVersions: new Set(['v1', 'v2']),
  ...fields,
});

test('the must-haves are unknown until there is text, a summary and a match', () => {
  assert.deepEqual(mustHavesOutcome(input({ hasText: false })), {
    outcome: 'unknown',
    reason: 'The app does not have the job text yet.',
    quote: null,
  });
  assert.equal(
    mustHavesOutcome(input({ requirementsKnown: false })).reason,
    'Summarise the job to find its must-haves.',
  );
  assert.deepEqual(mustHavesOutcome(input({ matched: undefined })), {
    outcome: 'unknown',
    reason: 'Not matched with your facts yet.',
    quote: null,
  });
  assert.deepEqual(mustHavesOutcome(input({ mustHaves: [], matched: undefined })), {
    outcome: 'met',
    reason: 'The job text names no must-haves.',
    quote: null,
  });
});

test('the must-haves are met only when every one is met by current facts', () => {
  assert.deepEqual(mustHavesOutcome(input()), {
    outcome: 'met',
    reason: 'Your facts meet all 2 must-haves.',
    quote: null,
  });
  assert.equal(
    mustHavesOutcome(input({ mustHaves: [must('go', 'Go')] })).reason,
    'Your facts meet its must-have.',
  );
  // A cited fact was edited since, and a must-have was added after the match.
  assert.deepEqual(mustHavesOutcome(input({ validFactVersions: new Set(['v1']) })), {
    outcome: 'unknown',
    reason: 'No evidence in your facts for “SQL”.',
    quote: 'SQL quoted',
  });
  assert.equal(
    mustHavesOutcome(input({ mustHaves: [must('go', 'Go'), must('new', 'Rust')] })).reason,
    'No evidence in your facts for “Rust”.',
  );
});

test('one must-have the facts do not meet makes them unmet, whatever else is unknown', () => {
  const matched = new Map([
    ['a', { outcome: 'unmet' as const, factVersionIds: ['v1'] }],
    ['b', { outcome: 'unknown' as const, factVersionIds: [] }],
  ]);
  const mustHaves = ['a', 'b', 'c', 'd', 'e'].map((id) => must(id, id.toUpperCase()));
  assert.deepEqual(mustHavesOutcome(input({ mustHaves, matched })), {
    outcome: 'unmet',
    reason: 'Your facts do not meet “A”.',
    quote: 'A quoted',
  });
  const open = mustHavesOutcome(
    input({ mustHaves, matched: new Map([['a', { outcome: 'met', factVersionIds: ['v1'] }]]) }),
  );
  assert.equal(open.reason, 'No evidence in your facts for “B”, “C”, “D”, 1 more.');
});

test('a match is out of date when the facts to send or the requirements change', () => {
  const same = {
    sentFacts: ['v1', 'v2'],
    sendableFacts: ['v2', 'v1'],
    matchedRequirements: ['r1'],
    currentRequirements: ['r1'],
  };
  assert.deepEqual(matchOutdated(same), []);
  assert.deepEqual(matchOutdated({ ...same, sendableFacts: ['v1', 'v3'] }), [
    'The facts that may be sent to DeepSeek have changed since.',
  ]);
  assert.deepEqual(matchOutdated({ ...same, sendableFacts: ['v1'], currentRequirements: [] }), [
    'The facts that may be sent to DeepSeek have changed since.',
    'The requirements have changed since.',
  ]);
});
