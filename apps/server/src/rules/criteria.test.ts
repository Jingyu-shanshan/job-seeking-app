import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Criteria, EmploymentType, SummaryFieldValue } from '@jsa/shared';
import { type Checked, type JobToCheck, checkJob, languageOf } from './criteria.ts';

const off = { strength: 'off', ifUnknown: 'to_confirm' } as const;

const nothing: Criteria = {
  location: { ...off, area: 'helsinki', includeRemote: false },
  title: { strength: 'off', words: [] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { ...off, languages: [] },
  employmentType: { ...off, types: [] },
  mustHaves: off,
};

const met: Checked = { outcome: 'met', reason: 'Your facts meet all 2 must-haves.', quote: null };

const job = (fields: Partial<JobToCheck> = {}): JobToCheck => ({
  title: 'Backend Engineer',
  location: 'Helsinki, Finland',
  summary: { languages: null, employmentType: null },
  mustHaves: met,
  ...fields,
});

const field = (value: string, quote = `${value}.`, quoteVerified = true): SummaryFieldValue => ({
  value,
  quote,
  quoteVerified,
});

const one = (j: JobToCheck, criteria: Partial<Criteria>) => {
  const { verdict, criteria: results } = checkJob(j, { ...nothing, ...criteria });
  assert.equal(results.length, 1);
  return { verdict, ...results[0]! };
};

test('with every criterion off, every job is eligible and nothing is checked', () => {
  assert.deepEqual(checkJob(job({ summary: 'none' }), nothing), {
    verdict: 'eligible',
    criteria: [],
  });
});

test('a hard criterion that is not met rules the job out; a preference only shows', () => {
  const words = { words: ['frontend', 'design'] };
  assert.deepEqual(one(job(), { title: { strength: 'hard', ...words } }), {
    verdict: 'ineligible',
    criterion: 'title',
    strength: 'hard',
    outcome: 'unmet',
    effect: 'rules_out',
    reason: 'The title has none of “frontend”, “design”.',
    quote: null,
  });
  const preferred = one(job(), { title: { strength: 'preference', ...words } });
  assert.deepEqual(
    [preferred.verdict, preferred.outcome, preferred.effect],
    ['eligible', 'unmet', 'none'],
  );
});

test('an unknown never counts as met: hard ones go to confirm, or rule out when chosen', () => {
  const unknownLanguage = job({ summary: 'unsummarised' });
  const languages = { strength: 'hard' as const, languages: ['English'] };
  const toConfirm = one(unknownLanguage, {
    languages: { ...languages, ifUnknown: 'to_confirm' },
  });
  assert.deepEqual(
    [toConfirm.verdict, toConfirm.outcome, toConfirm.effect, toConfirm.reason],
    ['to_confirm', 'unknown', 'to_confirm', 'Summarise the job to find its working language.'],
  );
  const ruledOut = one(unknownLanguage, { languages: { ...languages, ifUnknown: 'rule_out' } });
  assert.deepEqual(
    [ruledOut.verdict, ruledOut.outcome, ruledOut.effect],
    ['ineligible', 'unknown', 'rules_out'],
  );
  const preferred = one(unknownLanguage, {
    languages: { ...languages, strength: 'preference', ifUnknown: 'rule_out' },
  });
  assert.deepEqual([preferred.verdict, preferred.effect], ['eligible', 'none']);
});

test('a known failure wins over unknowns and over everything that is met', () => {
  const { verdict, criteria } = checkJob(
    job({ title: 'Senior Backend Engineer', summary: 'none' }),
    {
      ...nothing,
      location: { ...nothing.location, strength: 'hard' },
      title: { strength: 'hard', words: ['backend'] },
      avoidInTitle: { strength: 'hard', words: ['senior', 'staff'] },
      languages: { strength: 'hard', ifUnknown: 'to_confirm', languages: ['English'] },
      mustHaves: { strength: 'hard', ifUnknown: 'to_confirm' },
    },
  );
  assert.equal(verdict, 'ineligible');
  assert.deepEqual(
    criteria.map((c) => [c.criterion, c.outcome, c.effect, c.reason]),
    [
      ['location', 'met', 'none', 'The location is in your search scope.'],
      ['title', 'met', 'none', 'The title has “backend”.'],
      ['avoidInTitle', 'unmet', 'rules_out', 'The title has “senior”.'],
      ['languages', 'unknown', 'to_confirm', 'The app does not have the job text yet.'],
      ['mustHaves', 'met', 'none', 'Your facts meet all 2 must-haves.'],
    ],
  );
});

test('title words match whole words and phrases, ignoring case and spacing', () => {
  const title = (t: string, words: string[]) =>
    one(job({ title: t }), { title: { strength: 'hard', words } }).outcome;
  assert.equal(title('Software  Engineer, Payments', ['software engineer']), 'met');
  assert.equal(title('Back-end Developer', ['backend']), 'unmet');
  assert.equal(title('Backend Developer', ['back']), 'unmet');
  assert.equal(title('Senior C++ Engineer', ['c++']), 'met');
  assert.equal(title('Kehittäjä', ['kehittäjä']), 'met');
  const avoided = (t: string) =>
    one(job({ title: t }), { avoidInTitle: { strength: 'hard', words: ['lead'] } }).outcome;
  assert.equal(avoided('Team Lead'), 'unmet');
  assert.equal(avoided('Lead generation analyst'), 'unmet');
  assert.equal(avoided('Leadership coach'), 'met');
});

test('the location criterion reads the listing location with the search scope', () => {
  const location = (place: string, scope: Partial<Criteria['location']> = {}) => {
    const r = one(job({ location: place }), {
      location: { ...nothing.location, strength: 'hard', ...scope },
    });
    return [r.outcome, r.reason];
  };
  assert.deepEqual(location('Espoo, Finland'), ['met', 'The location is in your search scope.']);
  assert.deepEqual(location('Tampere, Finland'), ['unmet', 'Not in Helsinki or Espoo.']);
  assert.deepEqual(location('Tampere, Finland', { area: 'finland' })[0], 'met');
  assert.deepEqual(location(''), ['unknown', 'No location given.']);
  assert.deepEqual(location('Remote', { includeRemote: true }), [
    'unknown',
    'Remote, but it does not say from where.',
  ]);
});

test('the working language is unknown until a quoted summary field states it', () => {
  const languages = (summary: JobToCheck['summary']) =>
    one(job({ summary }), { languages: { ...off, strength: 'hard', languages: ['English'] } });
  assert.equal(languages('none').reason, 'The app does not have the job text yet.');
  assert.equal(
    languages({ languages: null, employmentType: null }).reason,
    'The job text does not state its working language.',
  );
  const unverified = languages({
    languages: field('English', 'We speak English', false),
    employmentType: null,
  });
  assert.deepEqual(
    [unverified.outcome, unverified.reason],
    ['unknown', 'The quote given for its working language is not in the job text.'],
  );
});

test('working languages: met when all are yours, unmet when none is, else to confirm', () => {
  const check = (value: string, mine = ['English']) =>
    one(job({ summary: { languages: field(value), employmentType: null } }), {
      languages: { ...off, strength: 'hard', languages: mine },
    });
  const result = (value: string, mine?: string[]) => {
    const r = check(value, mine);
    return [r.outcome, r.reason];
  };
  assert.deepEqual(result('English'), ['met', 'It is done in English.']);
  assert.deepEqual(result('Finnish'), ['unmet', 'It asks for Finnish.']);
  assert.deepEqual(result('Fluent Finnish and Swedish'), [
    'unmet',
    'It asks for Finnish and Swedish.',
  ]);
  assert.deepEqual(result('English and Finnish'), [
    'unknown',
    'It also asks for Finnish; check whether that is needed.',
  ]);
  // Languages marked optional in their part of the field do not count.
  for (const value of [
    'English; Finnish is a plus',
    'English (Finnish is an advantage)',
    'English, Swedish nice to have',
    'English. Finnish not required.',
  ]) {
    assert.deepEqual(result(value)[0], 'met', value);
  }
  assert.deepEqual(result('Finnish is a plus'), [
    'unknown',
    'The job names only optional languages: “Finnish is a plus”.',
  ]);
  assert.deepEqual(result('The local language'), [
    'unknown',
    'Its working language, “The local language”, names no language the app recognises.',
  ]);
  // Names that mean the same language, and the user's own spelling.
  assert.deepEqual(result('Mandarin', ['chinese'])[0], 'met');
  assert.deepEqual(result('English and Finnish', ['english', ' FINNISH '])[0], 'met');
  assert.equal(check('English').quote, 'English.');
});

test('knows language names, and only language names', () => {
  assert.equal(languageOf(' Finnish '), 'finnish');
  assert.equal(languageOf('Northern Sami'), 'northern sami');
  assert.equal(languageOf('Tagalog'), 'filipino');
  assert.equal(languageOf('Finland'), undefined);
  assert.equal(languageOf('Klingon'), undefined);
});

test('employment type: checks hours and arrangement separately, each only if asked', () => {
  const check = (value: string, accepted: EmploymentType[]) => {
    const r = one(job({ summary: { languages: null, employmentType: field(value) } }), {
      employmentType: { ...off, strength: 'hard', types: accepted },
    });
    return [r.outcome, r.reason];
  };
  assert.deepEqual(check('Full-time', ['full_time']), ['met', 'It is full-time.']);
  assert.deepEqual(check('Full time, permanent', ['full_time']), [
    'met',
    'It is full-time and permanent.',
  ]);
  assert.deepEqual(check('Part-time', ['full_time']), ['unmet', 'It is part-time.']);
  assert.deepEqual(check('Fixed-term contract, 12 months', ['full_time', 'permanent']), [
    'unmet',
    'It is fixed-term.',
  ]);
  assert.deepEqual(check('Permanent', ['full_time', 'permanent']), [
    'unknown',
    'The job text does not say whether it is full-time.',
  ]);
  assert.deepEqual(check('Full-time or part-time', ['full_time']), [
    'unknown',
    'It is full-time and part-time; check which applies.',
  ]);
  assert.deepEqual(check('Summer trainee', ['internship'])[0], 'met');
  assert.deepEqual(check('Freelance, B2B', ['contract'])[0], 'met');
  // "Contract" alone says too little: a permanent job also has one.
  assert.deepEqual(check('Permanent contract', ['permanent'])[0], 'met');
  assert.deepEqual(check('Contract', ['permanent'])[0], 'unknown');
});

test('the must-have criterion applies its strength to the outcome it is given', () => {
  const mustHaves: Checked = {
    outcome: 'unmet',
    reason: 'Your facts do not meet “Go”.',
    quote: '5+ years of Go',
  };
  assert.deepEqual(one(job({ mustHaves }), { mustHaves: { ...off, strength: 'hard' } }), {
    verdict: 'ineligible',
    criterion: 'mustHaves',
    strength: 'hard',
    outcome: 'unmet',
    effect: 'rules_out',
    reason: 'Your facts do not meet “Go”.',
    quote: '5+ years of Go',
  });
});
