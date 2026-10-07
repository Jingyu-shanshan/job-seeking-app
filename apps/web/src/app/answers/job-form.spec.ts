import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FormFill, FormQuestion, JobFormState, SavedAnswer } from '@jsa/shared';
import { JobForm } from './job-form';

const jobId = '00000000-0000-4000-8000-000000000001';
const savedId = '00000000-0000-4000-8000-000000000002';
const pdfId = '00000000-0000-4000-8000-000000000003';

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

const fill = (f: Partial<FormFill> & Pick<FormFill, 'question' | 'status' | 'note'>): FormFill => ({
  answer: [],
  source: null,
  savedAnswerId: null,
  documentPdfId: null,
  sensitive: false,
  answeredForJob: false,
  looksSensitive: false,
  ...f,
});

const fills: FormFill[] = [
  fill({
    question: question({ key: 'email', label: 'Email' }),
    status: 'filled',
    answer: ['test.person@example.com'],
    source: 'profile',
    note: 'From Your details: email.',
  }),
  fill({
    question: question({ key: 'first_name', label: 'First Name' }),
    status: 'needs_answer',
    note: 'Needs your answer.',
  }),
  fill({
    question: question({ key: 'resume', label: 'Resume/CV', kind: 'file' }),
    status: 'filled',
    answer: ['Test Person - Resume - Acme - Engineer.pdf'],
    source: 'document',
    documentPdfId: pdfId,
    note: 'The resume PDF you kept for this job.',
  }),
  fill({
    question: question({
      key: 'question_102',
      label: 'Will you now or in the future require sponsorship for a visa?',
      kind: 'single',
      options: ['Yes', 'No'],
      description: 'We can sponsor some visas.',
    }),
    status: 'needs_answer',
    note: 'Needs your answer.',
    looksSensitive: true,
  }),
  fill({
    question: question({
      key: 'question_104',
      label: 'Which languages do you work in?',
      kind: 'multi',
      options: ['English', 'Finnish', 'Swedish'],
      required: false,
    }),
    status: 'optional_empty',
    note: 'Optional: left empty.',
  }),
  fill({
    question: question({
      key: 'gender',
      label: 'Gender',
      kind: 'single',
      options: ['Decline To Self Identify', 'Female', 'Male'],
      group: 'compliance',
      required: false,
    }),
    status: 'held_back',
    savedAnswerId: savedId,
    sensitive: true,
    looksSensitive: true,
    note: 'Sensitive and optional: left empty unless you choose to answer it for this job.',
  }),
  fill({
    question: question({
      key: 'last_name',
      label: 'Last Name',
    }),
    status: 'filled',
    answer: ['Person'],
    source: 'job',
    answeredForJob: true,
    note: 'Your answer for this job.',
  }),
  fill({
    question: question({
      key: 'gdpr_processing_consent_given',
      label: 'Consent to the processing of your data for this application',
      kind: 'consent',
      group: 'consent',
    }),
    status: 'needs_answer',
    note: 'Give this consent for this application, or leave it.',
  }),
];

const state = (f: FormFill[] = fills): JobFormState => ({
  canRead: true,
  form: {
    id: '00000000-0000-4000-8000-000000000004',
    catalogId: 'greenhouse_board',
    readAt: '2026-10-07T08:00:00.000Z',
    lastReadAt: '2026-10-07T08:00:00.000Z',
    fills: f,
  },
});

const saved: SavedAnswer[] = [
  {
    id: savedId,
    wordings: ['Gender'],
    answer: ['Decline To Self Identify'],
    sensitive: true,
    places: [],
    updatedAt: '2026-10-07T08:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    wordings: ['Do you need visa sponsorship?'],
    answer: ['No'],
    sensitive: true,
    places: ['Finland'],
    updatedAt: '2026-10-07T08:00:00.000Z',
  },
];

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('JobForm', () => {
  let fixture: ComponentFixture<JobForm>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const item = (label: string) =>
    [...page().querySelectorAll('.questions > li')].find((li) =>
      text(li.querySelector('.label')).startsWith(label),
    )!;
  const button = (label: string, within: Element = page()) =>
    [...within.querySelectorAll('button')].find((b) => text(b) === label);
  const control = <T extends Element>(label: string, within: Element) =>
    [...within.querySelectorAll('label')]
      .find((l) => text(l).startsWith(label))!
      .querySelector<T & Element>('input, textarea, select')! as unknown as T;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JobForm],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(JobForm);
    fixture.componentRef.setInput('jobId', jobId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(form: JobFormState) {
    http.expectOne(`/api/jobs/${jobId}/form`).flush(form);
    await settle();
    if (form.form) http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();
  }

  async function open(label: string) {
    button('Answer for this job', item(label))!.click();
    await fixture.whenStable();
    return item(label);
  }

  it('reads the form on a click, saying what that sends', async () => {
    await load({ canRead: true, form: null });
    expect(text()).toContain(
      'Reading the form sends one request to the job board, and nothing about you.',
    );
    button('Read the application form')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/jobs/${jobId}/form`);
    expect(request.request.method).toBe('POST');
    expect(text(page().querySelector('[role=status]'))).toBe(
      'Reading the application form from the job board…',
    );
    request.flush(state());
    await settle();
    http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();
    expect(text()).toContain('8 questions: 3 filled, 3 need your answer, 2 optional left empty.');
    expect(button('Read the form again')).toBeDefined();
  });

  it('says which jobs it can read forms of', async () => {
    await load({ canRead: false, form: null });
    expect(text()).toContain(
      'The app reads application forms only from Greenhouse job boards you use',
    );
    expect(button('Read the application form')).toBeUndefined();
  });

  it('shows each question with its answer and where it comes from', async () => {
    await load(state());
    const lines = (label: string) => [...item(label).querySelectorAll('p')].map((p) => text(p));
    expect(lines('Email')).toEqual([
      'Email (required)',
      'Filled: test.person@example.com',
      'From Your details: email.',
      'Answer for this job',
    ]);
    expect(lines('First Name').slice(1, 3)).toEqual(['Needs your answer', 'Needs your answer.']);
    expect(text(item('First Name').querySelector('.label'))).toBe('First Name (required)');
    expect(text(item('Resume/CV'))).toContain('Test Person - Resume - Acme - Engineer.pdf');
    // A file is never answered here.
    expect(button('Answer for this job', item('Resume/CV'))).toBeUndefined();
    expect(text(item('Will you now'))).toContain('We can sponsor some visas.');
    expect(text(item('Gender').querySelector('.label'))).toBe(
      'Gender (optional) Self-identification Sensitive',
    );
    expect(lines('Gender')[1]).toBe(
      'Held back: your saved answer “Decline To Self Identify” is not used',
    );
    expect(text(item('Consent to'))).toContain('Consent');
  });

  it('answers a question for this job, and saves it for later if asked', async () => {
    await load(state());
    const li = await open('First Name');
    const input = control<HTMLInputElement>('Your answer for this job', li);
    input.value = 'Test';
    input.dispatchEvent(new Event('input'));
    control<HTMLInputElement>('Also save it for later', li).click();
    await fixture.whenStable();
    // Not sensitive by default: the question does not look it.
    expect(control<HTMLInputElement>('Sensitive', li).checked).toBe(false);
    const places = control<HTMLInputElement>('Only for jobs', li);
    places.value = 'Finland';
    places.dispatchEvent(new Event('input'));
    button('Save', li)!.click();
    const request = http.expectOne(`/api/jobs/${jobId}/form/answers/first_name`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      answer: ['Test'],
      save: { sensitive: false, places: ['Finland'] },
    });
    const answered = fill({
      question: fills[1]!.question,
      status: 'filled',
      answer: ['Test'],
      source: 'job',
      answeredForJob: true,
      note: 'Your answer for this job.',
    });
    request.flush(state(fills.map((f) => (f.question.key === 'first_name' ? answered : f))));
    await settle();
    // The saved answers are read again: there may be a new one.
    http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();
    expect(text(item('First Name').querySelectorAll('p')[1]!)).toBe('Filled: Test');
    expect(item('First Name').querySelector('form')).toBeNull();
  });

  it('takes one option, several options, or a consent', async () => {
    await load(state());
    let li = await open('Will you now');
    // Sensitive by default when saving: it looks it.
    control<HTMLInputElement>('Also save it for later', li).click();
    await fixture.whenStable();
    expect(control<HTMLInputElement>('Sensitive', li).checked).toBe(true);
    control<HTMLInputElement>('Also save it for later', li).click();
    button('Save', li)!.click();
    await fixture.whenStable();
    expect(text(li.querySelector('[role=alert]'))).toBe('Choose one of the options.');
    const select = control<HTMLSelectElement>('Your answer for this job', li);
    select.value = 'No';
    select.dispatchEvent(new Event('input'));
    select.dispatchEvent(new Event('change'));
    button('Save', li)!.click();
    let request = http.expectOne(`/api/jobs/${jobId}/form/answers/question_102`);
    expect(request.request.body).toEqual({ answer: ['No'] });
    request.flush(state());
    await settle();
    http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();

    li = await open('Which languages');
    const box = (label: string) =>
      [...li.querySelectorAll('fieldset label')]
        .find((l) => text(l) === label)!
        .querySelector('input')!;
    box('English').click();
    box('Swedish').click();
    box('English').click();
    box('Finnish').click();
    button('Save', li)!.click();
    request = http.expectOne(`/api/jobs/${jobId}/form/answers/question_104`);
    expect(request.request.body).toEqual({ answer: ['Swedish', 'Finnish'] });
    request.flush(state());
    await settle();
    http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();

    li = await open('Consent to');
    // A consent is never saved for later, nor taken from a saved answer.
    expect(text(li)).not.toContain('Also save it for later');
    expect(text(li)).not.toContain('Or use one of your saved answers');
    control<HTMLInputElement>('I give this consent', li).click();
    button('Save', li)!.click();
    request = http.expectOne(`/api/jobs/${jobId}/form/answers/gdpr_processing_consent_given`);
    expect(request.request.body).toEqual({ answer: ['yes'] });
    request.flush(state());
    await settle();
    http.expectOne('/api/answers').flush(saved);
    await fixture.whenStable();
  });

  it('answers a held-back question with the saved answer, and takes an answer back', async () => {
    await load(state());
    button('Use your saved answer for this job', item('Gender'))!.click();
    const use = http.expectOne(`/api/jobs/${jobId}/form/answers/gender`);
    expect(use.request.method).toBe('PUT');
    expect(use.request.body).toEqual({ answer: null });
    use.flush(state());
    await fixture.whenStable();
    // Only an answer given in the answer form can add a saved answer: no new read.

    button('Take back your answer for this job', item('Last Name'))!.click();
    const clear = http.expectOne(`/api/jobs/${jobId}/form/answers/last_name`);
    expect(clear.request.method).toBe('DELETE');
    clear.flush(
      { message: 'You gave no answer to this question for this job.' },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'You gave no answer to this question for this job.',
    );
  });

  it('uses a saved answer for a question worded differently', async () => {
    await load(state());
    const li = await open('Will you now');
    const pick = control<HTMLSelectElement>('Or use one of your saved answers', li);
    expect([...pick.options].map((o) => o.text)).toEqual([
      'Choose…',
      'Gender: Decline To Self Identify',
      'Do you need visa sponsorship?: No (Finland)',
    ]);
    pick.value = saved[1]!.id;
    pick.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    button('Use it', li)!.click();
    const refused = http.expectOne(`/api/jobs/${jobId}/form/answers/question_102/saved`);
    expect(refused.request.body).toEqual({ answerId: saved[1]!.id });
    refused.flush(
      { message: 'This saved answer is only for jobs whose location names Finland.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(text(li.querySelector('[role=alert]'))).toBe(
      'This saved answer is only for jobs whose location names Finland.',
    );
  });

  it('says why the form could not be read', async () => {
    await load({ canRead: true, form: null });
    button('Read the application form')!.click();
    http
      .expectOne(`/api/jobs/${jobId}/form`)
      .flush(
        { message: 'boards-api.greenhouse.io answered HTTP 500.' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'boards-api.greenhouse.io answered HTTP 500.',
    );
  });
});
