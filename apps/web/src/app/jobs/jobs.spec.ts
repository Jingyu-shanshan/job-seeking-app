import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DiscoveryRun, Job, JobsResponse, SourceRun } from '@jsa/shared';
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
  verdict: 'in_scope',
  reason: '',
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
  job({ title: 'Backend Engineer' }),
  job({
    title: 'Designer',
    location: '',
    verdict: 'to_confirm',
    reason: 'No location given.',
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
    verdict: 'out_of_scope',
    reason: 'Not in Helsinki or Espoo.',
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
      el.querySelector('h2')?.textContent?.startsWith(heading),
    ) as HTMLElement | undefined;
  const items = (heading: string) =>
    [...(section(heading)?.querySelectorAll('app-job-list li') ?? [])].map((li) => text(li));

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

  it('groups the jobs by the search scope and says why a job is not in it', async () => {
    await load();

    expect(text()).toContain('Scope: Helsinki and Espoo, remote jobs not included.');
    expect(items('In scope (1)')).toEqual([
      'Backend Engineer Acme · Helsinki, Finland · Job page Posted 20 Sep 2026 · Found 1 Oct 2026',
    ]);
    expect(items('To confirm (1)')).toEqual([
      'Designer Acme · No location given · Job page Posted 20 Sep 2026 · Found 1 Oct 2026 · Listed by 2 of your sources No location given.',
    ]);
    // Out of scope is collapsed, and names the board when the source gives no company.
    const out = section('Out of scope (1)')!;
    expect(out.tagName).toBe('DETAILS');
    expect(out.hasAttribute('open')).toBe(false);
    expect(items('Out of scope (1)')).toEqual([
      'Sales Lead acme · Berlin, Germany · Job page Found 1 Oct 2026 Not in Helsinki or Espoo.',
    ]);

    // 标题打开应用里的职位页，“Job page” 在新窗口打开来源上的页面。
    const [title, external] = section('In scope')!.querySelectorAll('a');
    expect(title!.getAttribute('href')).toBe(`/jobs/${jobs[0]!.id}`);
    expect(external!.getAttribute('href')).toBe('https://job-boards.example.com/acme/jobs/1');
    expect(external!.getAttribute('target')).toBe('_blank');
    expect(external!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('marks a pasted job, which has no source', async () => {
    await load([job({ title: 'Pasted Engineer', company: null, sources: [], publishedAt: null })]);

    expect(items('In scope (1)')).toEqual([
      'Pasted Engineer Company not given · Helsinki, Finland · Job page Pasted 1 Oct 2026',
    ]);
    expect(page().querySelector('a[href="/jobs/paste"]')).not.toBeNull();
  });

  it('shows only the in-scope group while there are no jobs', async () => {
    await load([]);

    expect(text(section('In scope (0)')!)).toContain('No jobs in scope yet.');
    expect(section('To confirm')).toBeUndefined();
    expect(section('Out of scope')).toBeUndefined();
  });

  it('finds jobs, then shows what each source gave and the refreshed list', async () => {
    await load([]);
    await findJobs();

    const request = http.expectOne('/api/discovery-runs');
    expect(request.request.method).toBe('POST');
    expect(text(page().querySelector('[role=status]'))).toBe(
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
    expect(summary).toContain('1 job in scope.');
    expect(summary).not.toContain('Why not more');
    expect(summary).toContain('acme (Some job boards): 3 jobs listed, 1 new, 0 no longer listed.');
    expect(summary).toContain('gone (Some job boards) could not be read: There is no such board.');
    expect(summary).toContain('later (Other boards) was skipped: The app cannot read these yet.');
    expect(summary).toContain('2 of at most 20 requests used.');
    expect(items('In scope (1)').length).toBe(1);
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
    expect(summary).toContain('1 job in scope. You wanted 5.');
    expect(summary).toContain('Why not more:');
    expect(summary).toContain('1 source could not be read; see below.');
    expect(summary).toContain('1 job needs its location checked; it is under To confirm.');
    expect(summary).toContain(
      '1 job is outside the scope (Helsinki and Espoo, remote jobs not included).',
    );
    expect(summary).toContain('The app does not add sources or widen the scope on its own.');
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
    expect(summary).toContain('1 job in scope. You wanted 1.');
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
  });
});
