import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CriterionResult, DiscoveryRun, Job, JobsResponse, SourceRun } from '@jsa/shared';
import { Jobs } from './jobs';

let nextId = 1;
const job = (fields: Partial<Job>): Job => ({
  id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
  title: 'Engineer',
  company: 'Acme',
  location: 'Helsinki, Finland',
  url: 'https://job-boards.example.com/acme/jobs/1',
  publishedAt: '2026-09-20T10:00:00.000Z',
  firstSeenAt: '2026-10-01T08:00:00.000Z',
  sources: [{ id: '00000000-0000-4000-8000-000000000001', catalogId: 'b', param: 'acme' }],
  alerts: [],
  origin: 'discovered',
  needsText: false,
  verdict: 'eligible',
  application: null,
  criteria: [],
  ...fields,
});

const result = (fields: Partial<CriterionResult>): CriterionResult => ({
  criterion: 'location',
  strength: 'hard',
  outcome: 'met',
  effect: 'none',
  reason: 'The location is in your search scope.',
  quote: null,
  ...fields,
});

const sourceRun = (fields: Partial<SourceRun>): SourceRun => ({
  sourceId: '00000000-0000-4000-8000-000000000001',
  catalogId: 'some_board',
  name: 'Some job boards',
  param: 'acme',
  outcome: 'ok',
  reason: '',
  found: 3,
  added: 1,
  closed: 0,
  ...fields,
});

const jobs: Job[] = [
  job({
    title: 'Backend Engineer',
    criteria: [
      result({}),
      // A preference it is known not to meet shows; an unknown one is left to the job page.
      result({
        criterion: 'title',
        strength: 'preference',
        outcome: 'unmet',
        reason: 'The title has none of “platform”.',
      }),
      result({
        criterion: 'mustHaves',
        strength: 'preference',
        outcome: 'unknown',
        reason: 'Not matched with your facts yet.',
      }),
    ],
  }),
  job({
    title: 'Designer',
    location: '',
    verdict: 'to_confirm',
    criteria: [result({ outcome: 'unknown', effect: 'to_confirm', reason: 'No location given.' })],
    sources: [
      { id: '00000000-0000-4000-8000-000000000001', catalogId: 'b', param: 'acme' },
      { id: '00000000-0000-4000-8000-000000000002', catalogId: 'b', param: 'ACME' },
    ],
  }),
  job({
    title: 'Sales Lead',
    company: null,
    location: 'Berlin, Germany',
    publishedAt: null,
    verdict: 'ineligible',
    criteria: [
      result({ outcome: 'unmet', effect: 'rules_out', reason: 'Not in Helsinki or Espoo.' }),
      result({
        criterion: 'languages',
        outcome: 'unknown',
        effect: 'rules_out',
        reason: 'Summarise the job to find its working language.',
      }),
    ],
  }),
];

const response = (list: Job[] = jobs): JobsResponse => ({
  scope: { area: 'helsinki', includeRemote: false },
  jobs: list,
});

/**
 * Lets a finished request's promise chain run and Angular render. Unlike `whenStable()`, it does
 * not wait for requests that are still open, such as the reload after a run.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('Jobs', () => {
  let fixture: ComponentFixture<Jobs>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const section = (heading: string) =>
    [...page().querySelectorAll('section, details')].find((el) =>
      el.querySelector('h2')?.textContent?.trim().startsWith(heading),
    ) as HTMLElement | undefined;
  const items = (heading: string) =>
    [
      ...(section(heading)?.querySelectorAll('app-job-list tbody > tr:not(.confirmation)') ?? []),
    ].map((li) => text(li));

  async function load(list?: Job[]) {
    http.expectOne('/api/jobs').flush(response(list));
    await fixture.whenStable();
  }

  async function findJobs(target?: string) {
    if (target !== undefined) {
      const input = page().querySelector<HTMLInputElement>('input[type=number]')!;
      input.value = target;
      input.dispatchEvent(new Event('input'));
    }
    page().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
  }

  async function choose(label: string, value: string) {
    const control = [...page().querySelectorAll('label')]
      .find((el) => text(el).startsWith(label))!
      .querySelector<HTMLInputElement | HTMLSelectElement>('input, select')!;
    control.value = value;
    control.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  const titles = () => [...page().querySelectorAll('app-job-list .title')].map((el) => text(el));
  const button = (name: string) =>
    [...page().querySelectorAll('button')].find((el) => text(el) === name)!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Jobs],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Jobs);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('filters all job groups by eligibility and application status, keeping unknown results distinct', async () => {
    await load([
      job({ title: 'Pasted', origin: 'pasted', verdict: 'to_confirm', application: 'submitted' }),
      job({ title: 'Board', verdict: 'ineligible', application: 'to_verify' }),
      job({ title: 'Needs text', needsText: true }),
    ]);
    await choose('Status', 'submitted');
    expect(titles()).toEqual(['Pasted']);
    await choose('Status', 'to_verify');
    expect(titles()).toEqual(['Board']);
    await choose('Status', 'not_applied');
    expect(titles()).toEqual(['Needs text']);
    await choose('Status', 'needs_text');
    expect(titles()).toEqual(['Needs text']);
    await choose('Status', 'to_confirm');
    expect(titles()).toEqual(['Pasted']);
    await choose('Status', 'eligible');
    expect(titles()).toEqual(['Needs text']);
    await choose('Status', 'ineligible');
    expect(titles()).toEqual(['Board']);
    button('Reset filters').click();
    await fixture.whenStable();
    expect(titles()).toHaveLength(3);
  });

  it('filters by inclusive local added dates, combines status, and explains invalid and empty ranges', async () => {
    await load([
      job({ title: 'Start', firstSeenAt: new Date(2026, 9, 1, 0, 0).toISOString() }),
      job({ title: 'End', firstSeenAt: new Date(2026, 9, 2, 23, 59).toISOString() }),
      job({ title: 'Outside', firstSeenAt: new Date(2026, 9, 3, 0, 0).toISOString() }),
    ]);
    await choose('Added from', '2026-10-01');
    await choose('Added through', '2026-10-02');
    expect(titles()).toEqual(['Start', 'End']);
    await choose('Status', 'submitted');
    expect(titles()).toEqual([]);
    expect(text()).toContain('No jobs match these filters.');
    await choose('Added from', '2026-10-03');
    expect(text(page().querySelector('[role=alert]'))).toContain('Choose an end date');
    button('Reset filters').click();
    await fixture.whenStable();
    expect(titles()).toHaveLength(3);
  });

  it('sorts within each group and keeps missing publication dates last', async () => {
    await load([
      job({
        title: 'Cedar',
        company: 'Aalto',
        firstSeenAt: '2026-10-03T12:00:00Z',
        publishedAt: null,
        origin: 'pasted',
        application: 'submitted',
      }),
      job({
        title: 'Birch',
        company: 'Virta',
        firstSeenAt: '2026-10-01T12:00:00Z',
        publishedAt: '2026-09-20T12:00:00Z',
        origin: 'pasted',
      }),
      job({
        title: 'Aspen',
        company: 'Kide',
        firstSeenAt: '2026-10-02T12:00:00Z',
        publishedAt: '2026-09-21T12:00:00Z',
        origin: 'pasted',
        verdict: 'ineligible',
      }),
    ]);
    for (const [sort, expected] of [
      ['newest', ['Cedar', 'Aspen', 'Birch']],
      ['oldest', ['Birch', 'Aspen', 'Cedar']],
      ['posted', ['Aspen', 'Birch', 'Cedar']],
      ['title', ['Aspen', 'Birch', 'Cedar']],
      ['company', ['Cedar', 'Aspen', 'Birch']],
      ['status', ['Birch', 'Aspen', 'Cedar']],
      ['relevance', ['Cedar', 'Birch', 'Aspen']],
    ] as const) {
      await choose('Sort by', sort);
      expect(titles()).toEqual(expected);
    }
  });

  it('confirms deletion, supports cancel, and removes only the selected duplicate after success', async () => {
    const first = job({ title: 'Duplicate', origin: 'pasted' });
    const second = job({ title: 'Duplicate', origin: 'pasted' });
    await load([first, second]);
    const remove = page().querySelector<HTMLButtonElement>(`[data-delete-id="${first.id}"]`)!;
    remove.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(button('Cancel'));
    http.expectNone((req) => req.method === 'DELETE');
    button('Cancel').click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(remove);
    remove.click();
    await fixture.whenStable();
    button('Confirm delete').click();
    await settle();
    const request = http.expectOne(`/api/jobs/${first.id}`);
    expect(request.request.method).toBe('DELETE');
    expect(button('Deleting…').disabled).toBe(true);
    expect(titles()).toHaveLength(2);
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await fixture.whenStable();
    expect(titles()).toEqual(['Duplicate']);
    expect(page().querySelector(`[data-delete-id="${second.id}"]`)).not.toBeNull();
    expect(text()).toContain('Saved text, drafts and application history are kept.');
    expect(document.activeElement?.getAttribute('role')).toBe('status');
  });

  it('keeps a job on deletion failure and lets the user retry, including deleting the last job', async () => {
    const only = job({ title: 'Only pasted role', origin: 'pasted' });
    await load([only]);
    button('Delete').click();
    await fixture.whenStable();
    button('Confirm delete').click();
    await settle();
    http
      .expectOne(`/api/jobs/${only.id}`)
      .flush({ message: 'Service unavailable.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    await fixture.whenStable();
    expect(titles()).toEqual(['Only pasted role']);
    expect(text(page().querySelector('[role=alert]'))).toContain('Service unavailable. Try again.');
    button('Confirm delete').click();
    await settle();
    http.expectOne(`/api/jobs/${only.id}`).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('No jobs yet');
    expect(titles()).toEqual([]);
  });

  it('finishes deletion even when filters hide the table during the request', async () => {
    const first = job({ title: 'Hidden while deleting', origin: 'pasted' });
    await load([first, job({ title: 'Remaining', verdict: 'to_confirm' })]);
    button('Delete').click();
    await fixture.whenStable();
    button('Confirm delete').click();
    await settle();
    const request = http.expectOne(`/api/jobs/${first.id}`);
    await choose('Status', 'to_confirm');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    button('Reset filters').click();
    await fixture.whenStable();
    expect(titles()).toEqual(['Remaining']);
  });

  it('groups the jobs by the hard criteria and says which criterion decided', async () => {
    await load();

    expect(text()).toContain('Location: Helsinki and Espoo, remote jobs not included.');
    expect(page().querySelector('a[href="/criteria"]')).not.toBeNull();
    const eligible = section('Eligible (1)')!;
    expect(text(eligible.querySelector('.title'))).toBe('Backend Engineer');
    expect(text(eligible.querySelector('.company'))).toBe('Acme');
    expect(text(eligible.querySelector('.state'))).toContain('Eligible');
    expect(text(eligible.querySelector('.reason'))).toBe(
      'Title (preference): The title has none of “platform”.',
    );
    expect(text(eligible.querySelector('.dates'))).toContain('1 Oct 2026');
    const confirm = section('To confirm (1)')!;
    expect(text(confirm.querySelector('.title'))).toBe('Designer');
    expect(text(confirm.querySelector('.reason'))).toBe('Location unknown: No location given.');
    expect(text(confirm)).toContain('No location given');
    expect(text(confirm)).toContain('Listed by 2 of your sources');
    const out = section('Ruled out (1)')!;
    expect(out.tagName).toBe('DETAILS');
    expect(out.hasAttribute('open')).toBe(false);
    expect(text(out.querySelector('.title'))).toBe('Sales Lead');
    expect(text(out.querySelector('.company'))).toBe('acme');
    expect(text(out)).toContain('Location: Not in Helsinki or Espoo.');
    expect(text(out)).toContain(
      'Working language unknown, and you rule out unknowns: Summarise the job to find its working language.',
    );

    const [title, external] = section('Eligible')!.querySelectorAll('a');
    expect(title!.getAttribute('href')).toBe(`/jobs/${jobs[0]!.id}`);
    expect(external!.getAttribute('href')).toBe('https://job-boards.example.com/acme/jobs/1');
    expect(external!.getAttribute('target')).toBe('_blank');
    expect(external!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('marks a pasted job, which has no source', async () => {
    await load([
      job({
        title: 'Pasted Engineer',
        company: null,
        sources: [],
        publishedAt: null,
        origin: 'pasted',
      }),
    ]);

    const imported = section('Your imported jobs (1)')!;
    expect(text(imported.querySelector('.title'))).toBe('Pasted Engineer');
    expect(text(imported.querySelector('.company'))).toBe('Company not given');
    expect(text(imported.querySelector('.dates'))).toContain('Pasted');
    expect(text(imported.querySelector('time'))).toBe('1 Oct 2026');
    expect(imported.querySelector('table')).not.toBeNull();
    expect(imported.querySelector('details')).toBeNull();
    expect(page().querySelector('a[href="/jobs/paste"]')).not.toBeNull();
  });

  it('keeps all user-added jobs together, including board jobs also imported by the user', async () => {
    await load([
      job({ title: 'Pasted role', origin: 'pasted', sources: [] }),
      job({ title: 'Email role', origin: 'alert', sources: [], verdict: 'to_confirm' }),
      job({ title: 'Linked role', origin: 'saved', sources: [], verdict: 'ineligible' }),
      job({ title: 'Also imported', imported: true }),
      job({ title: 'Board role' }),
    ]);
    expect(items('Your imported jobs (4)')).toHaveLength(4);
    expect(items('Eligible (1)')[0]).toContain('Board role');
    expect(items('Eligible (1)')[0]).not.toContain('Also imported');
    expect(page().querySelectorAll('app-job-list tbody > tr:not(.confirmation)')).toHaveLength(5);
    expect(text(section('Your imported jobs')!.querySelectorAll('.state')[2]!)).toBe('Ruled out');
  });

  it('labels a matching role without treating a hard failure as recommended', async () => {
    await load([
      job({
        title: 'Relevant role',
        criteria: [result({ criterion: 'title', strength: 'preference' })],
      }),
      job({
        title: 'Ruled out role',
        verdict: 'ineligible',
        criteria: [result({ criterion: 'title' })],
      }),
    ]);
    expect(items('Eligible (1)')[0]).toContain('Role match');
    expect(items('Ruled out (1)')[0]).not.toContain('Role match');
  });

  it('marks a job applied to, and one whose application’s result is unknown', async () => {
    await load([
      job({ title: 'Applied Engineer', application: 'submitted' }),
      job({ title: 'Pending Engineer', application: 'to_verify', publishedAt: null }),
      job({ title: 'Other Engineer', publishedAt: null }),
    ]);
    expect(
      [...section('Eligible (3)')!.querySelectorAll('.state')].map((cell) => text(cell)),
    ).toEqual(['Eligible Applied', 'Eligible Application result unknown', 'Eligible']);
  });

  it('marks a saved job, and one that still needs its text', async () => {
    const saved: Partial<Job> = { sources: [], publishedAt: null, origin: 'saved' };
    await load([
      job({ ...saved, title: 'Saved Engineer' }),
      job({ ...saved, title: 'Listed Engineer', needsText: true }),
    ]);

    const imported = section('Your imported jobs (2)')!;
    expect([...imported.querySelectorAll('.title')].map((el) => text(el))).toEqual([
      'Saved Engineer',
      'Listed Engineer',
    ]);
    expect([...imported.querySelectorAll('.dates')].every((el) => text(el).includes('Saved'))).toBe(
      true,
    );
    expect(text(imported.querySelector('.reason'))).toBe(
      'Needs the job text: paste it, or save its page.',
    );
  });

  it('marks a job from an alert email and says which alerts listed it', async () => {
    await load([
      job({
        sources: [],
        publishedAt: null,
        origin: 'alert',
        alerts: ['LinkedIn', 'Duunitori'],
        needsText: true,
        title: 'Alert Engineer',
      }),
      job({
        title: 'Board Engineer',
        imported: true,
        alerts: ['LinkedIn'],
        publishedAt: '2026-10-01T10:00:00.000Z',
      }),
    ]);

    const imported = section('Your imported jobs (2)')!;
    expect(text(imported)).toContain('In alert emails from LinkedIn, Duunitori');
    expect(text(imported.querySelector('.dates'))).toContain('From an alert email');
    expect(text(imported.querySelectorAll('.dates')[1]!)).toContain('Posted 1 Oct 2026');
    expect(text(imported.querySelector('.reason'))).toBe(
      'Needs the job text: paste it, or save its page.',
    );
  });

  it('shows no job page link for a job the app has no address for', async () => {
    await load([
      job({
        sources: [],
        publishedAt: null,
        origin: 'alert',
        alerts: ['Snaphunt'],
        needsText: true,
        title: 'Odoo Consultant',
        url: null,
      }),
    ]);
    const item = section('Your imported jobs (1)')!.querySelector(
      'app-job-list tbody > tr:not(.confirmation)',
    )!;
    expect(item.querySelector('a[target=_blank]')).toBeNull();
    expect(text(item)).toContain(
      'Needs the job text and link: open the job from the email, then paste its text or save its page.',
    );
  });

  it('explains an empty list with all ways to get a job', async () => {
    await load([]);

    expect(text()).toContain('No jobs yet');
    expect(section('Eligible')).toBeUndefined();
    expect(page().querySelector('a[href="/jobs/paste"]')).not.toBeNull();
    expect(page().querySelector('a[href="/jobs/alerts"]')).not.toBeNull();
    expect(page().querySelector('a[href="/sources"]')).not.toBeNull();
    expect(section('To confirm')).toBeUndefined();
    expect(section('Ruled out')).toBeUndefined();
  });

  it('finds jobs, then shows what each source gave and the refreshed list', async () => {
    await load([]);
    await findJobs();

    const request = http.expectOne('/api/discovery-runs');
    expect(request.request.method).toBe('POST');
    expect(text(page().querySelector('form [role=status]'))).toBe(
      'Reading your job boards. This can take a minute.',
    );
    request.flush({
      requests: 2,
      requestLimit: 20,
      sources: [
        sourceRun({}),
        sourceRun({
          sourceId: '00000000-0000-4000-8000-000000000002',
          param: 'gone',
          outcome: 'failed',
          reason: 'There is no such board.',
        }),
        sourceRun({
          sourceId: '00000000-0000-4000-8000-000000000003',
          name: 'Other boards',
          param: 'later',
          outcome: 'skipped',
          reason: 'The app cannot read these yet.',
        }),
      ],
    } satisfies DiscoveryRun);
    await settle();
    await load();

    const summary = text(section('Last run')!);
    expect(summary).toContain('1 job eligible.');
    expect(summary).not.toContain('Why not more');
    expect(summary).toContain('acme (Some job boards): 3 jobs listed, 1 new, 0 no longer listed.');
    expect(summary).toContain('gone (Some job boards) could not be read: There is no such board.');
    expect(summary).toContain('later (Other boards) was skipped: The app cannot read these yet.');
    expect(summary).toContain('2 of at most 20 requests used.');
    expect(items('Eligible (1)').length).toBe(1);
  });

  it('distinguishes jobs awaiting criteria checks from a list with no jobs', async () => {
    await load([jobs[1]!, jobs[2]!]);
    expect(text()).not.toContain('No jobs yet');
    expect(text(section('Eligible (0)')!)).toContain('Unknown information is not a pass.');
    expect(items('To confirm (1)')).toHaveLength(1);
    expect(section('Ruled out (1)')!.hasAttribute('open')).toBe(false);
    expect(section('To confirm (1)')!.querySelector('.badge.warning')?.textContent?.trim()).toBe(
      'To confirm',
    );
  });

  it('retries a failed list load without clearing the discovery target', async () => {
    const input = page().querySelector<HTMLInputElement>('input[type=number]')!;
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    http
      .expectOne('/api/jobs')
      .flush(
        { message: 'Sample service unavailable.' },
        { status: 503, statusText: 'Unavailable' },
      );
    await settle();
    expect(text()).toContain('The jobs could not be loaded. Sample service unavailable.');
    [...page().querySelectorAll('button')].find((b) => text(b) === 'Try again')!.click();
    await settle();
    await load();
    expect(input.value).toBe('7');
    expect(items('Eligible (1)')).toHaveLength(1);
  });

  it('keeps source results when the list refresh fails, without presenting old counts', async () => {
    await load();
    await findJobs('5');
    http.expectOne('/api/discovery-runs').flush({
      requests: 1,
      requestLimit: 20,
      sources: [sourceRun({ outcome: 'failed', reason: 'HTTP 503.' })],
    } satisfies DiscoveryRun);
    await settle();
    http.expectOne('/api/jobs').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(text(section('Last run')!)).toContain('HTTP 503.');
    expect(text(section('Last run')!)).toContain('Reload the job list');
    expect(text(section('Last run')!)).not.toContain('1 job eligible.');
  });

  it('explains a shortfall against the jobs wanted, without widening anything', async () => {
    await load();
    await findJobs('5');
    http.expectOne('/api/discovery-runs').flush({
      requests: 1,
      requestLimit: 20,
      sources: [sourceRun({ outcome: 'failed', reason: 'HTTP 503.' })],
    } satisfies DiscoveryRun);
    await settle();
    await load();

    const summary = text(section('Last run')!);
    expect(summary).toContain('1 job eligible. You wanted 5.');
    expect(summary).toContain('Why not more:');
    expect(summary).toContain('1 source could not be read; see below.');
    expect(summary).toContain(
      '1 job does not say enough for a hard criterion; it is under To confirm.',
    );
    expect(summary).toContain('1 job is ruled out by your criteria.');
    expect(summary).toContain('The app does not add sources or loosen your criteria on its own.');
  });

  it('says when the target is met', async () => {
    await load();
    await findJobs('1');
    http.expectOne('/api/discovery-runs').flush({
      requests: 1,
      requestLimit: 20,
      sources: [sourceRun({})],
    } satisfies DiscoveryRun);
    await settle();
    await load();

    const summary = text(section('Last run')!);
    expect(summary).toContain('1 job eligible. You wanted 1.');
    expect(summary).not.toContain('Why not more');
  });

  it('says there is nothing to read when no job board is in use', async () => {
    await load([]);
    await findJobs();
    http
      .expectOne('/api/discovery-runs')
      .flush({ requests: 0, requestLimit: 20, sources: [] } satisfies DiscoveryRun);
    await settle();
    await load([]);

    expect(text(section('Last run')!)).toContain('No job board is in use, so nothing was read.');
  });

  it('refuses a target that is not a whole number of at least 1', async () => {
    await load([]);
    for (const target of ['0', '2.5']) {
      await findJobs(target);
      expect(text(page().querySelector('[role=alert]'))).toBe(
        'Enter a whole number of at least 1, or leave it empty.',
      );
    }
    http.expectNone('/api/discovery-runs');
  });

  it('shows the server’s message when a run cannot start', async () => {
    await load([]);
    await findJobs();
    http
      .expectOne('/api/discovery-runs')
      .flush(
        { message: 'Jobs are already being looked for. Wait for that run.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();

    expect(text(page().querySelector('[role=alert]'))).toBe(
      'Jobs are already being looked for. Wait for that run.',
    );
    expect(section('Last run')).toBeUndefined();
    await findJobs();
    http
      .expectOne('/api/discovery-runs')
      .flush({ requests: 0, requestLimit: 20, sources: [] } satisfies DiscoveryRun);
    await settle();
    await load([]);
    expect(text(section('Last run')!)).toContain('No job board is in use');
  });
});
