import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FormQuestion, Profile } from '@jsa/shared';
import {
  type FillContext,
  type SavedAnswerState,
  fillForm,
  fillQuestion,
  fitAnswer,
  looksSensitive,
  placesCover,
  wordingKey,
} from './form-answers.ts';

const question = (
  q: Partial<FormQuestion> & Pick<FormQuestion, 'key' | 'label'>,
): FormQuestion => ({
  description: '',
  required: true,
  kind: 'text',
  options: [],
  group: 'questions',
  ...q,
});

const yesNo = (key: string, label: string, required = true) =>
  question({ key, label, kind: 'single', options: ['Yes', 'No'], required });

const profile: Profile = {
  name: 'Test Person',
  email: 'test.person@example.com',
  phone: '+358 40 000 0000',
  location: 'Helsinki',
  links: ['https://www.linkedin.com/in/test-person/', 'https://github.com/test-person'],
};

let id = 0;
const saved = (s: Partial<SavedAnswerState> & Pick<SavedAnswerState, 'wordings' | 'answer'>) => ({
  id: `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  sensitive: false,
  places: [],
  ...s,
});

const context = (c: Partial<FillContext> = {}): FillContext => ({
  location: 'Helsinki, Finland',
  profile,
  saved: [],
  jobAnswers: new Map(),
  documents: { resume: null, cover_letter: null },
  ...c,
});

describe('wordings', () => {
  test('ignore case, punctuation, spacing and curly apostrophes', () => {
    assert.equal(
      wordingKey('What’s your  notice period?*'),
      wordingKey("what's your notice period"),
    );
    assert.equal(wordingKey('Resume/CV'), 'resume cv');
    assert.notEqual(
      wordingKey('Are you authorised to work in Finland?'),
      wordingKey('Are you authorised to work in Sweden?'),
    );
  });

  test('places are whole words of the location', () => {
    assert.equal(placesCover([], ''), true);
    assert.equal(placesCover(['Finland'], 'Helsinki, Finland'), true);
    assert.equal(placesCover(['finland'], 'HELSINKI; Remote (Finland)'), true);
    assert.equal(placesCover(['Jyväskylä'], 'Jyväskylä, Finland'), true);
    assert.equal(placesCover(['Finland'], 'Remote, EU'), false);
    assert.equal(placesCover(['Espoo'], ''), false);
    // Not a part of a longer word.
    assert.equal(placesCover(['US'], 'Austin, Texas'), false);
    assert.equal(placesCover(['New York'], 'New York, NY, United States'), true);
  });
});

describe('answers that fit a question', () => {
  test('text takes one value, a line of text no line break', () => {
    const text = question({ key: 'q', label: 'Preferred name' });
    assert.deepEqual(fitAnswer(text, [' Test ']), { ok: true, values: ['Test'] });
    assert.equal(fitAnswer(text, ['a', 'b']).ok, false);
    assert.equal(fitAnswer(text, ['two\nlines']).ok, false);
    assert.equal(fitAnswer({ ...text, kind: 'textarea' }, ['two\nlines']).ok, true);
    assert.equal(fitAnswer(text, ['  ']).ok, false);
  });

  test('options are the form’s own words, matched without case or punctuation', () => {
    const select = question({
      key: 'q',
      label: 'Notice period',
      kind: 'single',
      options: ['Immediately', '1 month', '2-3 months'],
    });
    assert.deepEqual(fitAnswer(select, ['1 Month']), { ok: true, values: ['1 month'] });
    assert.deepEqual(fitAnswer(select, ['2–3 months']), { ok: true, values: ['2-3 months'] });
    assert.deepEqual(fitAnswer(select, ['3 months']), {
      ok: false,
      reason: '“3 months” is not one of its options.',
    });
    assert.equal(fitAnswer(select, ['Immediately', '1 month']).ok, false);
    const multi = { ...select, kind: 'multi' as const };
    assert.deepEqual(fitAnswer(multi, ['immediately', '1 month', 'Immediately']), {
      ok: true,
      values: ['Immediately', '1 month'],
    });
  });

  test('two options with the same words fit only exactly', () => {
    const select = question({ key: 'q', label: 'Q', kind: 'single', options: ['Yes', 'Yes!'] });
    assert.deepEqual(fitAnswer(select, ['Yes']), { ok: true, values: ['Yes'] });
    assert.equal(fitAnswer(select, ['yes']).ok, false);
  });

  test('a consent is given with “yes”; a file cannot be an answer', () => {
    const consent = question({ key: 'gdpr', label: 'Consent', kind: 'consent' });
    assert.deepEqual(fitAnswer(consent, ['yes']), { ok: true, values: ['Consent given'] });
    assert.equal(fitAnswer(consent, ['no']).ok, false);
    assert.equal(
      fitAnswer(question({ key: 'f', label: 'File', kind: 'file' }), ['x.pdf']).ok,
      false,
    );
  });
});

describe('filling a question', () => {
  test('nothing fits: a required question needs the user, an optional one stays empty', () => {
    const required = fillQuestion(question({ key: 'first_name', label: 'First Name' }), context());
    assert.equal(required.status, 'needs_answer');
    assert.deepEqual(required.answer, []);
    assert.equal(required.note, 'Needs your answer.');
    const optional = fillQuestion(
      question({ key: 'q1', label: 'How did you hear about us?', required: false }),
      context(),
    );
    assert.equal(optional.status, 'optional_empty');
    assert.equal(optional.source, null);
  });

  test('the user’s details fill the standard fields, links by their site', () => {
    const fills = fillForm(
      [
        question({ key: 'email', label: 'Email' }),
        question({ key: 'phone', label: 'Phone', required: false }),
        question({ key: 'location', label: 'Location', group: 'location' }),
        question({ key: 'question_1', label: 'LinkedIn Profile', required: false }),
        question({ key: 'question_2', label: 'GitHub URL', required: false }),
        question({ key: 'question_3', label: 'Website', required: false }),
        // Only the location question of the form's location part.
        question({ key: 'location', label: 'Where are you based?' }),
        // Never split from the name: the user answers first and last name.
        question({ key: 'first_name', label: 'First Name' }),
      ],
      context(),
    );
    assert.deepEqual(
      fills.map((f) => [f.status, f.answer[0] ?? null, f.source]),
      [
        ['filled', 'test.person@example.com', 'profile'],
        ['filled', '+358 40 000 0000', 'profile'],
        ['filled', 'Helsinki', 'profile'],
        ['filled', 'https://www.linkedin.com/in/test-person/', 'profile'],
        ['filled', 'https://github.com/test-person', 'profile'],
        ['optional_empty', null, null],
        ['needs_answer', null, null],
        ['needs_answer', null, null],
      ],
    );
    assert.equal(fills[0]!.note, 'From Your details: email.');
    const empty = fillQuestion(
      question({ key: 'phone', label: 'Phone' }),
      context({ profile: { ...profile, phone: '' } }),
    );
    assert.equal(empty.status, 'needs_answer');
  });

  test('a saved answer fills a question with its wording, before the user’s details', () => {
    const answer = saved({ wordings: ['First name', 'Email'], answer: ['Test'] });
    const first = fillQuestion(
      question({ key: 'first_name', label: 'First Name' }),
      context({ saved: [answer] }),
    );
    assert.equal(first.status, 'filled');
    assert.deepEqual(first.answer, ['Test']);
    assert.equal(first.source, 'saved');
    assert.equal(first.savedAnswerId, answer.id);
    assert.equal(first.note, 'Your saved answer.');
    const email = fillQuestion(
      question({ key: 'email', label: 'Email' }),
      context({ saved: [answer] }),
    );
    assert.equal(email.source, 'saved');
    // Another wording is another question.
    const other = fillQuestion(
      question({ key: 'q', label: 'First name (as in your passport)' }),
      context({ saved: [answer] }),
    );
    assert.equal(other.status, 'needs_answer');
  });

  test('a saved answer with places fills only jobs whose location names one', () => {
    const permit = saved({
      wordings: ['Are you legally authorised to work in the country of this job?'],
      answer: ['Yes'],
      places: ['Finland', 'Sweden'],
    });
    const q = yesNo('q', 'Are you legally authorized to work in the country of this job?');
    // authorised and authorized are different words: no match.
    assert.equal(fillQuestion(q, context({ saved: [permit] })).status, 'needs_answer');
    const same = yesNo('q', 'Are you legally authorised to work in the country of this job?');
    const helsinki = fillQuestion(same, context({ saved: [permit] }));
    assert.equal(helsinki.status, 'filled');
    assert.equal(helsinki.note, 'Your saved answer for jobs in Finland, Sweden.');
    const berlin = fillQuestion(same, context({ saved: [permit], location: 'Berlin, Germany' }));
    assert.equal(berlin.status, 'needs_answer');
    assert.equal(
      berlin.note,
      'Your saved answer is only for jobs whose location names “Finland”, “Sweden”; this job’s location “Berlin, Germany” names none of them.',
    );
    const unknown = fillQuestion(same, context({ saved: [permit], location: '' }));
    assert.equal(
      unknown.note,
      'Your saved answer is only for jobs whose location names “Finland”, “Sweden”; this job’s location names none of them.',
    );
  });

  test('two saved answers that fit the same question are the user’s to choose between', () => {
    const q = question({ key: 'q', label: 'Salary expectation' });
    const finland = saved({ wordings: ['Salary expectation'], answer: ['A'], places: ['Finland'] });
    const everywhere = saved({ wordings: ['Salary expectation'], answer: ['B'], sensitive: true });
    const both = fillQuestion(q, context({ saved: [finland, everywhere] }));
    assert.equal(both.status, 'needs_answer');
    assert.equal(both.sensitive, true);
    assert.match(both.note, /^2 of your saved answers/);
    const abroad = fillQuestion(q, context({ saved: [finland, everywhere], location: 'Oslo' }));
    assert.deepEqual(abroad.answer, ['B']);
  });

  test('a saved answer that is not one of the options is not used', () => {
    const answer = saved({ wordings: ['Notice period'], answer: ['3 months'] });
    const fill = fillQuestion(
      question({
        key: 'q',
        label: 'Notice period',
        kind: 'single',
        options: ['1 month', '2 months'],
      }),
      context({ saved: [answer] }),
    );
    assert.equal(fill.status, 'needs_answer');
    assert.equal(fill.savedAnswerId, answer.id);
    assert.equal(
      fill.note,
      'Your saved answer does not fit this question: “3 months” is not one of its options.',
    );
  });

  test('a sensitive saved answer fills a required question, and an optional one only when chosen', () => {
    const answer = saved({
      wordings: ['Do you require visa sponsorship?'],
      answer: ['No'],
      sensitive: true,
    });
    const required = fillQuestion(
      yesNo('q', 'Do you require visa sponsorship?'),
      context({ saved: [answer] }),
    );
    assert.equal(required.status, 'filled');
    assert.equal(required.sensitive, true);
    const optional = yesNo('q', 'Do you require visa sponsorship?', false);
    const held = fillQuestion(optional, context({ saved: [answer] }));
    assert.equal(held.status, 'held_back');
    assert.deepEqual(held.answer, []);
    assert.equal(held.savedAnswerId, answer.id);
    const chosen = fillQuestion(
      optional,
      context({
        saved: [answer],
        jobAnswers: new Map([['q', { label: 'Do you require visa sponsorship?', answer: null }]]),
      }),
    );
    assert.equal(chosen.status, 'filled');
    assert.deepEqual(chosen.answer, ['No']);
    assert.equal(chosen.answeredForJob, true);
  });

  test('self-identification questions are sensitive whatever the saved answer says', () => {
    const answer = saved({ wordings: ['Gender'], answer: ['Decline To Self Identify'] });
    const gender = question({
      key: 'gender',
      label: 'Gender',
      kind: 'single',
      options: ['Decline To Self Identify', 'Female', 'Male'],
      group: 'compliance',
      required: false,
    });
    const fill = fillQuestion(gender, context({ saved: [answer] }));
    assert.equal(fill.status, 'held_back');
    assert.equal(fill.sensitive, true);
    assert.equal(fill.looksSensitive, true);
  });

  test('the user’s answer for this job comes first, while the form asks the same question', () => {
    const q = yesNo('q', 'Have you worked for us before?');
    const answer = saved({ wordings: ['Have you worked for us before?'], answer: ['No'] });
    const mine = { label: 'Have you worked for us before', answer: ['yes'] };
    const fill = fillQuestion(q, context({ saved: [answer], jobAnswers: new Map([['q', mine]]) }));
    assert.deepEqual(fill.answer, ['Yes']);
    assert.equal(fill.source, 'job');
    // The form now asks something else under the same field: the old answer does not count.
    const reworded = fillQuestion(
      yesNo('q', 'Have you ever worked for us or our subsidiaries?'),
      context({ jobAnswers: new Map([['q', mine]]) }),
    );
    assert.equal(reworded.status, 'needs_answer');
    assert.equal(reworded.answeredForJob, true);
    assert.equal(
      reworded.note,
      'Your answer for this job was to an earlier wording: “Have you worked for us before”.',
    );
    // Its options changed: the saved answer is used again.
    const changed = fillQuestion(
      question({
        key: 'q',
        label: 'Have you worked for us before?',
        kind: 'single',
        options: ['No', 'Yes, as staff'],
      }),
      context({ saved: [answer], jobAnswers: new Map([['q', mine]]) }),
    );
    assert.equal(changed.source, 'saved');
  });

  test('consent is given only for this job, never from a saved answer', () => {
    const consent = question({
      key: 'gdpr_processing_consent_given',
      label: 'Consent',
      kind: 'consent',
    });
    const answer = saved({ wordings: ['Consent'], answer: ['yes'] });
    const asked = fillQuestion(consent, context({ saved: [answer] }));
    assert.equal(asked.status, 'needs_answer');
    assert.equal(asked.note, 'Give this consent for this application, or leave it.');
    const given = fillQuestion(
      consent,
      context({ jobAnswers: new Map([[consent.key, { label: 'Consent', answer: ['yes'] }]]) }),
    );
    assert.equal(given.status, 'filled');
    assert.deepEqual(given.answer, ['Consent given']);
  });

  test('the resume and cover letter come from the PDFs kept for this job', () => {
    const resume = question({ key: 'resume', label: 'Resume/CV', kind: 'file' });
    const letter = question({
      key: 'cover_letter',
      label: 'Cover Letter',
      kind: 'file',
      required: false,
    });
    const other = question({ key: 'question_9', label: 'Portfolio', kind: 'file' });
    const pdf = {
      id: '00000000-0000-4000-8000-0000000000aa',
      fileName: 'Test Person - Resume.pdf',
    };
    const [r, l, o] = fillForm(
      [resume, letter, other],
      context({ documents: { resume: pdf, cover_letter: null } }),
    );
    assert.deepEqual([r!.status, r!.answer, r!.documentPdfId], ['filled', [pdf.fileName], pdf.id]);
    assert.equal(r!.note, 'The resume PDF you kept for this job.');
    assert.equal(l!.status, 'optional_empty');
    assert.equal(l!.note, 'Keep a PDF of this job’s cover letter on its document page.');
    assert.equal(o!.status, 'needs_answer');
    assert.equal(o!.note, 'The app cannot attach this file; you attach it in the form yourself.');
  });
});

test('questions that look sensitive', () => {
  const asks = (label: string) => looksSensitive(question({ key: 'q', label }));
  for (const label of [
    'What are your salary expectations?',
    'Will you now or in the future require sponsorship for a visa?',
    'Are you legally authorized to work in the United States?',
    'Do you have a valid work permit for Finland?',
    'What is your nationality?',
    'Gender',
    'What is your age?',
  ]) {
    assert.equal(asks(label), true, label);
  }
  for (const label of [
    'First Name',
    'Have you used PayPal?',
    'Do you manage a team?',
    'LinkedIn',
  ]) {
    assert.equal(asks(label), false, label);
  }
});
