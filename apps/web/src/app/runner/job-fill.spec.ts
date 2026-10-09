import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  FillApproval,
  FillTask,
  FormCheck,
  JobApplication,
  JobFillState,
  PreviewField,
} from '@jsa/shared';
import { JobFill } from './job-fill';

const jobId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const checkId = '00000000-0000-4000-8000-000000000003';

const now = () => new Date().toISOString();

const task = (t: Partial<FillTask> = {}): FillTask => ({
  id: taskId,
  status: 'waiting',
  message: 'Waiting for the runner on your computer to take it.',
  url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7',
  createdAt: now(),
  updatedAt: now(),
  runnerSeenAt: null,
  check: null,
  ...t,
});

const preview = (p: Partial<PreviewField> & Pick<PreviewField, 'key' | 'label'>): PreviewField => ({
  required: true,
  value: [],
  appAnswer: [],
  source: null,
  state: 'as_filled',
  ...p,
});

const check: FormCheck = {
  id: checkId,
  checkedAt: '2026-10-07T09:00:00.000Z',
  blocker: null,
  screenshotUrl: `/api/fill-checks/${checkId}/screenshot`,
  fields: [
    preview({ key: 'first_name', label: 'First Name', value: ['Test'], appAnswer: ['Test'] }),
    preview({
      key: 'email',
      label: 'Email',
      value: ['other@example.com'],
      appAnswer: ['test.person@example.com'],
      state: 'changed',
    }),
    preview({ key: 'country', label: 'Country', state: 'left_empty' }),
    preview({ key: 'gender', label: 'Gender', required: false, state: 'left_empty' }),
    preview({
      key: 'question_9',
      label: 'Notice period',
      appAnswer: ['One month'],
      state: 'missing',
    }),
  ],
};

const state = (s: Partial<JobFillState> = {}): JobFillState => ({
  cannotStart: null,
  task: null,
  runnerSeenAt: now(),
  approval: null,
  application: null,
  ...s,
});

const approval = (a: Partial<FillApproval> = {}): FillApproval => ({
  problem: null,
  snapshot: { id: '00000000-0000-4000-8000-000000000009', capturedAt: '2026-10-07T09:00:00.000Z' },
  files: [{ label: 'Resume/CV', fileName: 'Test Person - Resume.pdf', sha256: 'ab'.repeat(32) }],
  submittedLastDay: 1,
  dailyCap: 5,
  approvedAt: null,
  ...a,
});

const applicationId = '00000000-0000-4000-8000-000000000004';
const application = (a: Partial<JobApplication> = {}): JobApplication => ({
  id: applicationId,
  status: 'to_verify',
  method: 'runner',
  createdAt: '2026-10-07T09:05:00.000Z',
  submittedAt: null,
  receipt: null,
  ...a,
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('JobFill', () => {
  let fixture: ComponentFixture<JobFill>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => text(b) === label);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JobFill],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(JobFill);
    fixture.componentRef.setInput('jobId', jobId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  async function load(s: JobFillState) {
    http.expectOne(`/api/jobs/${jobId}/fill`).flush(s);
    await fixture.whenStable();
  }

  async function click(label: string, url: string, answer: JobFillState) {
    button(label)!.click();
    TestBed.tick();
    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    request.flush(answer);
    await settle();
    await fixture.whenStable();
  }

  it('says why a fill cannot start', async () => {
    await load(state({ cannotStart: 'Answer these questions first: “First Name”.' }));
    expect(text()).toContain(
      'Nothing is sent to the company until you approve submitting this one form below.',
    );
    expect(text()).toContain('Answer these questions first: “First Name”.');
    expect(button('Fill in the form with the runner')).toBeUndefined();
  });

  it('starts a fill, and says when no runner is asking for work', async () => {
    await load(state({ runnerSeenAt: null }));
    await click(
      'Fill in the form with the runner',
      `/api/jobs/${jobId}/fill`,
      state({
        task: task(),
        cannotStart: 'The runner has this job’s form already.',
        runnerSeenAt: null,
      }),
    );
    expect(text()).toContain(
      'Waiting for the runner. Waiting for the runner on your computer to take it.',
    );
    expect(text()).toContain('No runner has asked the app for work in the last half minute.');
    expect(text()).toContain('npm run runner');
    expect(button('Fill in the form with the runner')).toBeUndefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('follows an open fill until it ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await load(state({ task: task({ status: 'filling', runnerSeenAt: now() }) }));
      expect(text()).toContain('Filling in.');
      vi.advanceTimersByTime(2000);
      TestBed.tick();
      http
        .expectOne(`/api/jobs/${jobId}/fill`)
        .flush(state({ task: task({ status: 'closed', message: 'Closed.' }) }));
      await fixture.whenStable();
      expect(text()).toContain('Last fill: Closed. Closed.');
      vi.advanceTimersByTime(4000);
      TestBed.tick();
      // A closed fill is not followed any more.
      http.expectNone(`/api/jobs/${jobId}/fill`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a paused fill: what the form holds, what to look at, and Continue', async () => {
    const paused = task({
      status: 'paused',
      message: 'Check these in the browser window, then press Continue.',
      runnerSeenAt: now(),
      check,
    });
    await load(state({ task: paused, cannotStart: 'The runner has this job’s form already.' }));
    expect(text()).toContain(
      'Paused: your turn. Check these in the browser window, then press Continue.',
    );
    const items = [...page().querySelectorAll('.fields > li')];
    // Each part is a line of its own.
    const lines = (li: Element) => [...li.children].map((part) => text(part)).join(' ');
    expect(items.map(lines)).toEqual([
      'First Name (required) Test As the app filled it in',
      'Email (required) other@example.com Not what the app filled in The app put in: test.person@example.com',
      'Country (required) — Empty',
      'Gender (optional) — Empty',
      'Notice period (required) — Not on the page The app put in: One month',
    ]);
    expect(items.map((li) => li.classList.contains('problem'))).toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);
    const image = page().querySelector<HTMLImageElement>('img.screenshot')!;
    expect(image.getAttribute('src')).toBe(`/api/fill-checks/${checkId}/screenshot`);
    expect(image.alt).toBe('The form as the runner saw it');

    await click(
      'Continue',
      `/api/fill-tasks/${taskId}/continue`,
      state({
        task: { ...paused, status: 'filling', message: 'The runner is looking at the form again.' },
      }),
    );
    expect(text()).toContain('The runner is looking at the form again.');
  });

  it('a filled form: look again, or close the window', async () => {
    const filled = task({ status: 'filled', message: 'Filled in.', runnerSeenAt: now(), check });
    await load(state({ task: filled, cannotStart: 'The runner has this job’s form already.' }));
    expect(text()).toContain('Filled in, stopped before Submit. Filled in.');
    expect(button('Look at the form again')).toBeDefined();
    await click(
      'Close the window',
      `/api/fill-tasks/${taskId}/close`,
      state({ task: { ...filled, status: 'closed', message: 'You closed this fill.' } }),
    );
    expect(text()).toContain('Last fill: Closed. You closed this fill.');
    expect(button('Fill in the form with the runner')).toBeDefined();
    // The last look stays to read.
    expect(page().querySelectorAll('.fields > li').length).toBe(5);
  });

  it('says when the runner has gone quiet, and shows why a move was refused', async () => {
    const quiet = task({ status: 'paused', runnerSeenAt: '2026-10-07T08:00:00.000Z' });
    await load(state({ task: quiet, cannotStart: 'The runner has this job’s form already.' }));
    expect(text()).toMatch(
      /The runner has not been in touch since \d\d:00:00\. If it stopped, close this fill\./,
    );
    button('Continue')!.click();
    TestBed.tick();
    http
      .expectOne(`/api/fill-tasks/${taskId}/continue`)
      .flush(
        { message: 'This fill is closed, so that cannot be done now.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    http
      .expectOne(`/api/jobs/${jobId}/fill`)
      .flush(state({ task: { ...quiet, status: 'closed' } }));
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'This fill is closed, so that cannot be done now.',
    );
  });

  it('a filled form: what an approval binds, and approving it', async () => {
    const filled = task({ status: 'filled', message: 'Filled in.', runnerSeenAt: now(), check });
    await load(state({ task: filled, approval: approval() }));
    const section = page().querySelector('section.approval')!;
    expect(text(section)).toContain(
      'Approving lets the runner press Submit once, for this job only',
    );
    expect([...section.querySelectorAll('.binds > li')].map((li) => text(li))).toEqual([
      expect.stringMatching(/^the value of every field below, as read at \d\d:00:00;$/),
      expect.stringMatching(/^the job’s text as read on 7 Oct 2026, \d\d:00;$/),
      'Resume/CV: Test Person - Resume.pdf (SHA-256 abababababab…);',
      'your answers and documents as the fill started with them.',
    ]);
    expect(text(section)).toContain(
      '1 of at most 5 applications went in (or may have) in the last 24 hours.',
    );
    button('Approve and submit')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/fill-tasks/${taskId}/approve`);
    expect(request.request.body).toEqual({ checkId });
    request.flush(
      state({
        task: { ...filled, status: 'approved', message: 'You approved submitting this form.' },
        approval: approval({ approvedAt: now() }),
      }),
    );
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('Approved for submitting. You approved submitting this form.');
    expect(button('Approve and submit')).toBeUndefined();
    await click(
      'Withdraw your approval',
      `/api/fill-tasks/${taskId}/withdraw`,
      state({ task: filled, approval: approval() }),
    );
    expect(button('Approve and submit')).toBeDefined();
  });

  it('says why a form cannot be approved, or why an approval no longer holds', async () => {
    const filled = task({ status: 'filled', runnerSeenAt: now(), check });
    await load(
      state({ task: filled, approval: approval({ problem: 'The form is not complete.' }) }),
    );
    expect(text(page().querySelector('.approval .warning'))).toBe('The form is not complete.');
    expect(button('Approve and submit')).toBeUndefined();

    await click(
      'Look at the form again',
      `/api/fill-tasks/${taskId}/continue`,
      state({
        task: { ...filled, status: 'approved' },
        approval: approval({
          approvedAt: now(),
          problem: 'The job’s text changed since you approved.',
        }),
      }),
    );
    expect(text(page().querySelector('.approval .warning'))).toBe(
      'This approval no longer holds: The job’s text changed since you approved. The runner will not press Submit; it gives the form back to you.',
    );
  });

  it('while Submit is pressed there is nothing to close; then the receipt', async () => {
    const submitting = task({
      status: 'submitting',
      message: 'The runner pressed Submit and waits for Greenhouse’s confirmation page.',
      runnerSeenAt: now(),
      check,
    });
    await load(state({ task: submitting, application: application() }));
    expect(text()).toContain('Submit pressed. The runner pressed Submit and waits');
    expect(button('Close the window')).toBeUndefined();
    // Not settled while the runner watches.
    expect(button('It went through')).toBeUndefined();
  });

  it('a submitted application: the confirmation the runner saw', async () => {
    await load(
      state({
        task: task({ status: 'submitted', message: 'Greenhouse showed its confirmation page.' }),
        cannotStart: 'This job’s application went in already.',
        application: application({
          status: 'submitted',
          submittedAt: '2026-10-07T09:05:00.000Z',
          receipt: {
            confirmed: true,
            pageUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=7',
            pageText: 'Thank you for applying to Acme!',
            note: '',
            checkedAt: '2026-10-07T09:05:03.000Z',
            screenshotUrl: '/api/submit-receipts/r1/screenshot',
          },
        }),
      }),
    );
    const section = page().querySelector('section.application')!;
    expect(text(section.querySelector('h4'))).toBe('Application: Submitted');
    expect(text(section)).toContain('and Greenhouse showed its confirmation page.');
    expect(text(section)).toContain('Thank you for applying to Acme!');
    expect(section.querySelector('img')!.getAttribute('src')).toBe(
      '/api/submit-receipts/r1/screenshot',
    );
    expect(text()).toContain('This job’s application went in already.');
  });

  it('a result to verify: the user says whether it went through', async () => {
    await load(
      state({
        task: task({ status: 'to_verify', message: 'Submit was pressed.' }),
        cannotStart: 'The result of this job’s application is unknown.',
        application: application({
          receipt: {
            confirmed: false,
            pageUrl: null,
            pageText: '',
            note: 'The window was closed before Greenhouse’s confirmation page showed.',
            checkedAt: '2026-10-07T09:06:00.000Z',
            screenshotUrl: null,
          },
        }),
      }),
    );
    expect(text()).toContain('Application: Result unknown');
    expect(text()).toContain('The window was closed before Greenhouse’s confirmation page showed.');
    button('It did not go through')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/applications/${applicationId}/settle`);
    expect(request.request.body).toEqual({ submitted: false });
    request.flush(state({ application: application({ status: 'not_submitted' }) }));
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('Application: Did not go through');
    expect(button('Fill in the form with the runner')).toBeDefined();
  });

  it('an application sent outside the app: the user’s record, and a link to what it kept', async () => {
    await load(
      state({
        cannotStart: 'This job’s application went in already.',
        application: application({
          status: 'submitted',
          method: 'manual',
          createdAt: '2026-10-09T10:00:00.000Z',
          submittedAt: '2026-10-08T15:30:00.000Z',
        }),
      }),
    );
    const section = page().querySelector('section.application')!;
    expect(text(section)).toContain('You recorded that you sent it outside the app on 8 Oct 2026');
    expect(text(section)).not.toContain('The runner pressed Submit');
    expect(section.querySelector('a')!.getAttribute('href')).toBe(`/applications/${applicationId}`);
  });

  it('tells the page when its application changes', async () => {
    let changed = 0;
    fixture.componentInstance.applicationChanged.subscribe(() => changed++);
    await load(
      state({
        task: task({ status: 'to_verify', message: 'Submit was pressed.' }),
        application: application(),
      }),
    );
    expect(changed).toBe(0);
    await click(
      'It went through',
      `/api/applications/${applicationId}/settle`,
      state({
        task: task({ status: 'to_verify', message: 'Submit was pressed.' }),
        application: application({ status: 'submitted', submittedAt: '2026-10-07T09:05:00.000Z' }),
      }),
    );
    expect(changed).toBe(1);
  });
});
