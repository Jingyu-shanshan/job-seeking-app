import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FillTask, FormCheck, JobFillState, PreviewField } from '@jsa/shared';
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
  ...s,
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
    expect(text()).toContain('stops before Submit, so nothing is sent to the company');
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
});
