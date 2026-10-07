import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FillField, FormFill, PageField, PreviewField } from '@jsa/shared';
import {
  type FillEvent,
  canHappen,
  cannotFill,
  checkOutcome,
  fillFields,
  previewFields,
  problems,
} from './fill.ts';

const pdfId = '00000000-0000-4000-8000-000000000001';

const fill = (
  f: Partial<FormFill> & { key: string; label: string; kind?: FormFill['question']['kind'] },
): FormFill => {
  const { key, label, kind = 'text', ...rest } = f;
  return {
    question: {
      key,
      label,
      kind,
      description: '',
      required: true,
      options: [],
      group: 'questions',
    },
    status: 'filled',
    answer: [],
    source: null,
    savedAnswerId: null,
    documentPdfId: null,
    sensitive: false,
    note: '',
    answeredForJob: false,
    looksSensitive: false,
    ...rest,
  };
};

const field = (f: Partial<FillField> & Pick<FillField, 'key' | 'label'>): FillField => ({
  kind: 'text',
  group: 'questions',
  required: true,
  answer: [],
  source: null,
  documentPdfId: null,
  ...f,
});

const onPage = (p: Partial<PageField> & Pick<PageField, 'key'>): PageField => ({
  label: p.key,
  required: false,
  kind: 'text',
  value: [],
  ...p,
});

describe('starting a fill', () => {
  test('keeps every question, with answers only for the filled ones', () => {
    const fields = fillFields([
      fill({ key: 'email', label: 'Email', answer: ['test@example.com'], source: 'profile' }),
      fill({
        key: 'resume',
        label: 'Resume/CV',
        kind: 'file',
        answer: ['Resume.pdf'],
        source: 'document',
        documentPdfId: pdfId,
      }),
      // A held-back answer is not put in, although the fill names the saved answer.
      fill({ key: 'gender', label: 'Gender', kind: 'single', status: 'held_back', answer: [] }),
      fill({ key: 'phone', label: 'Phone', status: 'optional_empty' }),
    ]);
    assert.deepEqual(
      fields.map((f) => [f.key, f.kind, f.answer, f.source, f.documentPdfId]),
      [
        ['email', 'text', ['test@example.com'], 'profile', null],
        ['resume', 'file', ['Resume.pdf'], 'document', pdfId],
        ['gender', 'single', [], null, null],
        ['phone', 'text', [], null, null],
      ],
    );
  });

  test('needs every required question answered in the app first', () => {
    assert.equal(cannotFill([fill({ key: 'email', label: 'Email', answer: ['x'] })]), null);
    assert.equal(
      cannotFill([
        fill({ key: 'first_name', label: 'First Name', status: 'needs_answer' }),
        fill({ key: 'email', label: 'Email', answer: ['x'] }),
        fill({ key: 'q', label: `What   is ${'very '.repeat(30)}long?`, status: 'needs_answer' }),
      ]),
      `Answer these questions first: “First Name”, “What is ${'very '.repeat(14)}v…”.`,
    );
    const many = Array.from({ length: 7 }, (_, i) =>
      fill({ key: `q${i}`, label: `Q${i}`, status: 'needs_answer' }),
    );
    assert.equal(
      cannotFill(many),
      'Answer these questions first: “Q0”, “Q1”, “Q2”, “Q3”, “Q4” and 2 more.',
    );
  });
});

describe('what the form holds', () => {
  const fields = [
    field({ key: 'first_name', label: 'First Name', answer: ['Test'], source: 'job' }),
    field({ key: 'email', label: 'Email', answer: ['test@example.com'], source: 'profile' }),
    field({
      key: 'question_1[]',
      label: 'Languages',
      kind: 'multi',
      answer: ['English', 'Finnish'],
      source: 'saved',
    }),
    field({ key: 'consent', label: 'Consent', kind: 'consent', answer: ['Consent given'] }),
    field({ key: 'gender', label: 'Gender', kind: 'single', required: false }),
    field({ key: 'question_9', label: 'Notice period', answer: ['One month'], source: 'saved' }),
  ];

  test('compares each field with what the runner put in', () => {
    const preview = previewFields(fields, [
      onPage({ key: 'first_name', label: ' First  Name ', required: true, value: [' Test '] }),
      onPage({ key: 'email', label: 'Email', required: true, value: ['other@example.com'] }),
      // Options in another order are the same options.
      onPage({
        key: 'question_1[]',
        label: 'Languages',
        kind: 'select',
        value: ['Finnish', 'English'],
      }),
      onPage({ key: 'consent', label: '', kind: 'checkbox', value: ['checked'] }),
      onPage({ key: 'gender', label: 'Gender', kind: 'select', value: ['Female'] }),
      // A field the app does not know, typed in the window, and one left empty.
      onPage({
        key: 'school--0',
        label: 'School',
        required: true,
        kind: 'select',
        value: ['Aalto'],
      }),
      onPage({ key: 'country', label: 'Country', value: ['', ' '] }),
    ]);
    assert.deepEqual(
      preview.map((p) => [p.key, p.label, p.required, p.value, p.appAnswer, p.state]),
      [
        ['first_name', 'First Name', true, [' Test '], ['Test'], 'as_filled'],
        ['email', 'Email', true, ['other@example.com'], ['test@example.com'], 'changed'],
        [
          'question_1[]',
          'Languages',
          true,
          ['Finnish', 'English'],
          ['English', 'Finnish'],
          'as_filled',
        ],
        // The page gives no label: the app's is shown.
        ['consent', 'Consent', true, ['checked'], ['Consent given'], 'as_filled'],
        ['gender', 'Gender', false, ['Female'], [], 'from_window'],
        ['school--0', 'School', true, ['Aalto'], [], 'from_window'],
        ['country', 'Country', false, [], [], 'left_empty'],
        // The notice period the runner had an answer for is not on the page.
        ['question_9', 'Notice period', true, [], ['One month'], 'missing'],
      ],
    );
    assert.equal(preview.find((p) => p.key === 'email')!.source, 'profile');
  });

  test('a field the runner filled that is empty, and an unchecked consent', () => {
    const preview = previewFields(fields.slice(0, 4), [
      onPage({ key: 'first_name', value: [] }),
      onPage({ key: 'email', value: ['test@example.com'] }),
      onPage({ key: 'question_1[]', kind: 'select', value: ['English'] }),
      onPage({ key: 'consent', kind: 'checkbox', value: [] }),
    ]);
    assert.deepEqual(
      preview.map((p) => p.state),
      ['empty', 'as_filled', 'changed', 'empty'],
    );
  });
});

describe('where a look at the form leaves the fill', () => {
  const preview = (p: Partial<PreviewField> & Pick<PreviewField, 'label' | 'state'>) => ({
    key: p.label,
    required: false,
    value: [],
    appAnswer: [],
    source: null,
    ...p,
  });
  const fine = [preview({ label: 'Email', state: 'as_filled', required: true })];
  const wrong = [
    preview({ label: 'First Name', state: 'empty', required: true }),
    preview({ label: 'School', state: 'left_empty', required: true }),
    preview({ label: 'Country', state: 'left_empty' }),
    preview({ label: 'Phone', state: 'empty' }),
    preview({ label: 'Email', state: 'changed', required: true }),
    preview({ label: 'Gender', state: 'from_window' }),
    preview({ label: 'Notice period', state: 'missing' }),
  ];

  test('lists what the user should look at', () => {
    assert.deepEqual(problems(fine), []);
    assert.deepEqual(problems(wrong), [
      'required and empty: “First Name”, “School”',
      'not what the app filled in: “Phone”, “Email”',
      'not found on the page: “Notice period”',
    ]);
  });

  test('a CAPTCHA or a sign-in always pauses', () => {
    for (const filledNow of [true, false]) {
      const captcha = checkOutcome(fine, 'captcha', filledNow);
      assert.equal(captcha.status, 'paused');
      assert.match(captcha.message, /prove you are not a robot.*never does that/);
      const login = checkOutcome(fine, 'login', filledNow);
      assert.equal(login.status, 'paused');
      assert.match(login.message, /keeps no passwords/);
    }
  });

  test('right after filling, any problem pauses; after the user’s Continue, the form is taken as it is', () => {
    assert.deepEqual(checkOutcome(fine, null, true), {
      status: 'filled',
      message: 'Nothing has been sent to the company.',
    });
    assert.deepEqual(checkOutcome(wrong, null, true), {
      status: 'paused',
      message:
        'Check these in the browser window, then press Continue. Required and empty: “First Name”, “School”. Not what the app filled in: “Phone”, “Email”. Not found on the page: “Notice period”.',
    });
    const after = checkOutcome(wrong, null, false);
    assert.equal(after.status, 'filled');
    assert.match(
      after.message,
      /^Nothing has been sent to the company\. Some fields are not as the app filled them in\.$/,
    );
  });
});

test('what may happen to a fill in each status', () => {
  const events: FillEvent[] = ['claim', 'check', 'fail', 'window_closed', 'continue', 'close'];
  const table = Object.fromEntries(
    (['waiting', 'filling', 'paused', 'filled', 'closed', 'failed'] as const).map((status) => [
      status,
      events.filter((event) => canHappen(status, event)),
    ]),
  );
  assert.deepEqual(table, {
    waiting: ['claim', 'close'],
    filling: ['check', 'fail', 'window_closed', 'close'],
    paused: ['fail', 'window_closed', 'continue', 'close'],
    filled: ['fail', 'window_closed', 'continue', 'close'],
    closed: [],
    failed: [],
  });
});
