import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FillField, PageField } from '@jsa/shared';
import { previewFields } from './fill.ts';
import {
  type ApprovalFacts,
  approvalProblem,
  changedAnswers,
  changedFields,
  dailyCap,
  isConfirmationPage,
  submitProblem,
} from './submit.ts';

const pdfId = '00000000-0000-4000-8000-000000000001';
const otherPdfId = '00000000-0000-4000-8000-000000000002';

const field = (f: Partial<FillField> & Pick<FillField, 'key' | 'label'>): FillField => ({
  kind: 'text',
  group: 'questions',
  required: true,
  answer: [],
  source: 'job',
  documentPdfId: null,
  ...f,
});

const fields: FillField[] = [
  field({ key: 'first_name', label: 'First Name', answer: ['Test'] }),
  field({
    key: 'resume',
    label: 'Resume/CV',
    kind: 'file',
    answer: ['Resume.pdf'],
    source: 'document',
    documentPdfId: pdfId,
  }),
  field({ key: 'question_1', label: 'Countries', kind: 'multi', answer: ['Finland', 'Estonia'] }),
  field({ key: 'gender', label: 'Gender', required: false, source: null }),
];

const page = (f: Partial<PageField> & Pick<PageField, 'key' | 'value'>): PageField => ({
  label: f.key,
  required: true,
  kind: 'text',
  ...f,
});

const look: PageField[] = [
  page({ key: 'first_name', label: 'First Name', value: ['Test'] }),
  page({ key: 'resume', label: 'Resume/CV', kind: 'file', value: ['Resume.pdf'] }),
  page({ key: 'question_1', label: 'Countries', kind: 'select', value: ['Finland', 'Estonia'] }),
  page({ key: 'gender', label: 'Gender', required: false, value: [] }),
  page({ key: 'country', label: 'Country', kind: 'select', value: ['Finland'] }),
];

const facts = (more: Partial<ApprovalFacts> = {}): ApprovalFacts => ({
  openApplication: null,
  snapshotId: 'snapshot-1',
  fillFields: fields,
  currentFields: fields,
  blocker: null,
  preview: previewFields(fields, look),
  submittedLastDay: 0,
  ...more,
});

describe('approving a filled form', () => {
  test('a complete look of unchanged answers may be approved', () => {
    assert.equal(approvalProblem(facts()), null);
    assert.equal(approvalProblem(facts({ approvedSnapshotId: 'snapshot-1' })), null);
  });

  test('a job that has an application that went in, or may have, is not approved again', () => {
    assert.equal(
      approvalProblem(facts({ openApplication: 'submitted' })),
      'This job’s application went in already.',
    );
    assert.match(approvalProblem(facts({ openApplication: 'to_verify' }))!, /^The result of/);
  });

  test('the job text: there must be one, and the one approved', () => {
    assert.match(approvalProblem(facts({ snapshotId: null }))!, /no text of this job/);
    assert.equal(
      approvalProblem(facts({ approvedSnapshotId: 'snapshot-0' })),
      'The job’s text changed since you approved.',
    );
  });

  test('changed answers, documents or form void it', () => {
    const answer = fields.map((f) => (f.key === 'first_name' ? { ...f, answer: ['Tess'] } : f));
    assert.match(approvalProblem(facts({ currentFields: answer }))!, /: “First Name”\. Close/);
    const pdf = fields.map((f) => (f.key === 'resume' ? { ...f, documentPdfId: otherPdfId } : f));
    assert.match(approvalProblem(facts({ currentFields: pdf }))!, /: “Resume\/CV”\. Close/);
    assert.match(
      approvalProblem(facts({ currentFields: 'Read the job’s application form first.' }))!,
      /^The app would not fill this form now: Read the job’s application form first\. Close/,
    );
  });

  test('the look: no blocker, no empty required field', () => {
    assert.match(approvalProblem(facts({ blocker: 'captcha' }))!, /only you can do/);
    const empty = look.map((f) => (f.key === 'country' ? { ...f, value: [] } : f));
    assert.equal(
      approvalProblem(facts({ preview: previewFields(fields, empty) })),
      'The form is not complete: required and empty: “Country”. Fill them in in the window and look again.',
    );
  });

  test('at most five in 24 hours', () => {
    assert.equal(dailyCap, 5);
    assert.equal(approvalProblem(facts({ submittedLastDay: 4 })), null);
    assert.match(approvalProblem(facts({ submittedLastDay: 5 }))!, /^5 applications went in/);
  });
});

describe('what changed', () => {
  test('answers: by question, in any order, a question that came or went', () => {
    const reordered = fields.map((f) =>
      f.key === 'question_1' ? { ...f, answer: ['Estonia', ' Finland '] } : f,
    );
    assert.deepEqual(changedAnswers(fields, reordered), []);
    assert.deepEqual(
      changedAnswers(fields, [
        ...fields,
        field({ key: 'question_2', label: 'New', answer: ['x'] }),
      ]),
      ['New'],
    );
    // A new question with nothing to put in changes nothing the runner did.
    assert.deepEqual(
      changedAnswers(fields, [...fields, field({ key: 'question_2', label: 'New' })]),
      [],
    );
    assert.deepEqual(changedAnswers(fields, fields.slice(1)), ['First Name']);
  });

  test('the page: a value typed, removed, or a field that came or went', () => {
    assert.deepEqual(changedFields(look, [...look].reverse()), []);
    const typed = look.map((f) => (f.key === 'gender' ? { ...f, value: ['Woman'] } : f));
    assert.deepEqual(changedFields(look, typed), ['Gender']);
    assert.deepEqual(changedFields(look, look.slice(0, -1)), ['Country']);
    assert.equal(submitProblem(look, look, null), null);
    assert.equal(
      submitProblem(look, typed, null),
      'The form changed after you approved it: “Gender”. Look at it again and approve it again if it is right.',
    );
    assert.match(submitProblem(look, look, 'login')!, /only you can do just before Submit/);
  });
});

test('Greenhouse’s confirmation page of the same form', () => {
  const form = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7';
  const ok = 'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=7';
  assert.equal(isConfirmationPage(ok, form), true);
  for (const other of [
    null,
    'not a url',
    'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=8',
    'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=other&token=7',
    'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7',
    'https://example.com/embed/job_app/confirmation?for=acme&token=7',
    'http://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=7',
  ]) {
    assert.equal(isConfirmationPage(other, form), false, String(other));
  }
});
