import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type {
  CriterionResult,
  Draft,
  Evidence,
  JobDetail,
  Match,
  ModelUsage,
  Requirement,
  Snapshot,
  SummaryFields,
} from '@jsa/shared';
import { JobDetailPage } from './job-detail';

const jobId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';

const nullFields: SummaryFields = {
  location: null,
  workplace: null,
  employmentType: null,
  languages: null,
  seniority: null,
  salary: null,
  visaSponsorship: null,
};

const requirement = (fields: Partial<Requirement>): Requirement => ({
  id: '00000000-0000-4000-8000-000000000010',
  text: 'Python',
  quote: '5+ years of Python',
  quoteVerified: true,
  kind: 'must',
  origin: 'model',
  evidence: null,
  ...fields,
});

const snapshot = (fields: Partial<Snapshot> = {}): Snapshot => ({
  id: snapshotId,
  capturedAt: '2026-10-02T08:00:00.000Z',
  catalogId: 'greenhouse_board',
  title: 'Backend Engineer',
  company: 'Acme',
  location: 'Helsinki, Finland',
  url: 'https://job-boards.example.com/acme/jobs/1',
  text: 'You will build APIs.\n- 5+ years of Python',
  summary: null,
  requirements: [],
  match: null,
  drafts: [],
  ...fields,
});

const detail = (fields: Partial<JobDetail> = {}): JobDetail => ({
  id: jobId,
  title: 'Backend Engineer',
  company: 'Acme',
  location: 'Helsinki, Finland',
  url: 'https://job-boards.example.com/acme/jobs/1',
  sources: [{ id: '00000000-0000-4000-8000-000000000003', catalogId: 'b', param: 'acme' }],
  canImport: true,
  saved: false,
  alerts: [],
  snapshot: null,
  earlierSnapshots: 0,
  verdict: 'eligible',
  criteria: [],
  factsToSend: 2,
  factsToDraft: 1,
  ...fields,
});

const summarised = (
  requirements: Requirement[],
  fields: Partial<JobDetail> = {},
  snapshotFields: Partial<Snapshot> = {},
) =>
  detail({
    ...fields,
    snapshot: snapshot({
      summary: {
        createdAt: '2026-10-02T08:05:00.000Z',
        model: 'deepseek-flash',
        costUsd: 0.0012,
        responsibilities: [
          { text: 'Build APIs', quote: 'You will build APIs.', quoteVerified: true },
          { text: 'Lead a team', quote: 'You will lead a team.', quoteVerified: false },
        ],
        fields: {
          ...nullFields,
          location: { value: 'Helsinki', quote: 'Helsinki office', quoteVerified: false },
          languages: { value: 'English', quote: 'We work in English.', quoteVerified: true },
        },
      },
      requirements,
      ...snapshotFields,
    }),
  });

const usage: ModelUsage = {
  calls: 3,
  failed: 1,
  costUsd: 0.0042,
  inputTokens: 9000,
  outputTokens: 1500,
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('JobDetailPage', () => {
  let fixture: ComponentFixture<JobDetailPage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => text(b) === label);
  const section = (heading: string) =>
    [...page().querySelectorAll('section')].find((s) => text(s.querySelector('h2')) === heading);
  const listUnder = (heading: string) => {
    const h3 = [...page().querySelectorAll('h3')].find((h) => text(h) === heading);
    let el = h3?.nextElementSibling;
    while (el && el.tagName !== 'UL' && el.tagName !== 'H3') el = el.nextElementSibling;
    if (el?.tagName !== 'UL') return [];
    return [...el.querySelectorAll(':scope > li')].map((li) => text(li));
  };

  async function load(job: JobDetail) {
    http.expectOne(`/api/jobs/${jobId}`).flush(job);
    http.expectOne('/api/model-usage').flush(usage);
    await settle();
    // The application form section (T16) and the runner's fill (T17) load on their own.
    http.expectOne(`/api/jobs/${jobId}/form`).flush({ canRead: false, form: null });
    http.expectOne(`/api/jobs/${jobId}/fill`).flush({
      cannotStart: 'The runner fills only the forms of jobs on a Greenhouse board you use.',
      task: null,
      runnerSeenAt: null,
    });
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JobDetailPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(JobDetailPage);
    fixture.componentRef.setInput('id', jobId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('reads a discovered job’s text, then offers a summary with the cost so far', async () => {
    await load(detail());
    expect(text(page().querySelector('h1'))).toBe('Backend Engineer');
    expect(text()).toContain('Listed by acme.');
    expect(text(section('Job text')!)).toContain('The job text has not been read yet.');
    expect(text(section('Summary')!)).toContain(
      'The app reads the job text from the job board first.',
    );

    button('Read the job text')!.click();
    const request = http.expectOne(`/api/jobs/${jobId}/snapshots`);
    expect(request.request.method).toBe('POST');
    request.flush(detail({ snapshot: snapshot(), earlierSnapshots: 1 }));
    await settle();

    expect(text(section('Job text')!)).toContain(
      'Read from the job board 2 Oct 2026. 1 earlier version kept.',
    );
    expect(text(page().querySelector('pre'))).toBe('You will build APIs. - 5+ years of Python');
    expect(button('Check for a newer version')).toBeDefined();
    expect(text(section('Summary')!)).toContain(
      'DeepSeek use so far: 3 requests, 1 failed, about $0.0042.',
    );
  });

  it('shows the summary with only quoted points, and what is still to confirm', async () => {
    await load(detail({ snapshot: snapshot() }));
    button('Summarise with DeepSeek')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/snapshots/${snapshotId}/summary`);
    expect(request.request.method).toBe('POST');
    expect(text(page().querySelector(':scope > [role=status]'))).toBe(
      'Summarising with DeepSeek. This can take a minute.',
    );
    request.flush(
      summarised([
        requirement({}),
        requirement({
          id: '00000000-0000-4000-8000-000000000011',
          text: 'Go',
          kind: 'nice',
          quote: 'Go is a plus',
          origin: 'user',
        }),
        requirement({
          id: '00000000-0000-4000-8000-000000000012',
          text: 'A degree',
          quote: 'A degree',
          quoteVerified: false,
        }),
      ]),
    );
    await settle();
    http.expectOne('/api/model-usage').flush({ ...usage, calls: 4 });
    await settle();

    expect(listUnder('Responsibilities')).toEqual(['Build APIs “You will build APIs.”']);
    expect(listUnder('Must have')).toEqual([
      'Python “5+ years of Python” Show in the job text Correct Remove',
    ]);
    expect(listUnder('Nice to have')).toEqual([
      'Go added by you “Go is a plus” Show in the job text Correct Remove',
    ]);
    expect(listUnder('Requirements to confirm')).toEqual([
      'Must have A degree “A degree” Correct Remove',
    ]);
    expect(listUnder('Responsibilities to confirm')).toEqual([
      'Lead a team “You will lead a team.”',
    ]);
    const details = text(page().querySelector('dl'));
    expect(details).toContain(
      'Location Unknown: the quote given for “Helsinki” is not in the job text.',
    );
    expect(details).toContain('Working languages English “We work in English.”');
    expect(details).toContain('Salary Not stated in the job text.');
    expect(text(section('Summary')!)).toContain(
      'Summarised by deepseek-flash on 2 Oct 2026, about $0.0012.',
    );
  });

  it('says why a summary failed, and counts the failed request', async () => {
    await load(detail({ snapshot: snapshot() }));
    button('Summarise with DeepSeek')!.click();
    http
      .expectOne(`/api/snapshots/${snapshotId}/summary`)
      .flush(
        { message: 'The DeepSeek account has no balance left (HTTP 402).' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await settle();
    http.expectOne('/api/model-usage').flush({ ...usage, calls: 4, failed: 2 });
    await settle();

    expect(text(page().querySelector('[role=alert]'))).toBe(
      'The DeepSeek account has no balance left (HTTP 402).',
    );
    expect(text()).toContain('DeepSeek use so far: 4 requests, 2 failed');
  });

  it('corrects and removes a requirement', async () => {
    await load(summarised([requirement({})]));

    button('Correct')!.click();
    await fixture.whenStable();
    const form = page().querySelector('app-requirement-form')!;
    const input = form.querySelector('input')!;
    expect(input.value).toBe('Python');
    input.value = 'Python 3';
    input.dispatchEvent(new Event('input'));
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();

    const request = http.expectOne(`/api/snapshots/${snapshotId}/requirements`);
    expect(request.request.body).toEqual({
      text: 'Python 3',
      kind: 'must',
      quote: '5+ years of Python',
      replaces: '00000000-0000-4000-8000-000000000010',
    });
    request.flush(
      summarised([
        requirement({
          id: '00000000-0000-4000-8000-000000000020',
          text: 'Python 3',
          origin: 'user',
        }),
      ]),
    );
    await settle();
    expect(listUnder('Must have')).toEqual([
      'Python 3 added by you “5+ years of Python” Show in the job text Correct Remove',
    ]);

    button('Remove')!.click();
    const removal = http.expectOne('/api/requirements/00000000-0000-4000-8000-000000000020');
    expect(removal.request.method).toBe('DELETE');
    removal.flush(summarised([]));
    await settle();
    expect(listUnder('Must have')).toEqual([]);
    expect(text()).toContain('None found in the job text.');
  });

  it('cannot read a pasted job’s text from anywhere', async () => {
    await load(
      detail({ sources: [], canImport: false, snapshot: snapshot({ catalogId: 'paste' }) }),
    );
    expect(text()).toContain('You pasted this job.');
    expect(text(section('Job text')!)).toContain('Pasted 2 Oct 2026.');
    expect(button('Check for a newer version')).toBeUndefined();
  });

  it('reads the text first when summarising a job whose text was not read yet', async () => {
    await load(detail());
    button('Summarise with DeepSeek')!.click();
    http.expectOne(`/api/jobs/${jobId}/snapshots`).flush(detail({ snapshot: snapshot() }));
    await settle();
    const request = http.expectOne(`/api/snapshots/${snapshotId}/summary`);
    expect(request.request.method).toBe('POST');
    request.flush(summarised([requirement({})]));
    await settle();
    http.expectOne('/api/model-usage').flush(usage);
    await settle();
    expect(listUnder('Must have')).toEqual([
      'Python “5+ years of Python” Show in the job text Correct Remove',
    ]);
  });

  it('shows no summary when the text cannot be read from anywhere', async () => {
    await load(detail({ sources: [], canImport: false }));
    expect(section('Summary')).toBeUndefined();
    expect(text(section('Job text')!)).toContain('You can paste it here.');
  });

  it('says where a saved job’s text came from', async () => {
    await load(
      detail({
        saved: true,
        snapshot: snapshot({ catalogId: 'desktop_save' }),
        earlierSnapshots: 0,
      }),
    );
    expect(text()).toContain('Listed by acme. You saved this job in the desktop app.');
    expect(text(section('Job text')!)).toContain(
      'Saved from its page in the desktop app 2 Oct 2026.',
    );
  });

  it('takes pasted text for a job saved from a results page, then offers a summary', async () => {
    await load(detail({ sources: [], canImport: false, saved: true }));
    expect(text()).toContain('You saved this job in the desktop app.');
    expect(text(section('Job text')!)).toContain(
      'The app has only what a results page showed about this job',
    );
    expect(section('Summary')).toBeUndefined();

    button('Save the text')!.click();
    await settle();
    expect(text(section('Job text')!)).toContain('Paste the job text.');
    http.expectNone(`/api/jobs/${jobId}/text`);

    const textarea = page().querySelector('textarea')!;
    textarea.value = 'Backend Engineer\n\nYou will build APIs.';
    textarea.dispatchEvent(new Event('input'));
    button('Save the text')!.click();
    await settle();
    const request = http.expectOne(`/api/jobs/${jobId}/text`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ text: 'Backend Engineer\n\nYou will build APIs.' });
    request.flush(
      detail({
        sources: [],
        canImport: false,
        saved: true,
        snapshot: snapshot({ catalogId: 'paste' }),
      }),
    );
    await settle();
    expect(text(section('Job text')!)).toContain('Pasted 2 Oct 2026.');
    expect(button('Summarise with DeepSeek')).toBeDefined();
  });

  it('shows the alert emails that listed a job and asks for the text of one without it', async () => {
    await load(
      detail({
        sources: [],
        canImport: false,
        alerts: [
          {
            catalogId: 'linkedin_alert',
            name: 'LinkedIn',
            subject: '“engineer”: new jobs',
            sentAt: '2026-10-02T07:12:00.000Z',
            firstSeenAt: '2026-10-02T08:00:00.000Z',
            url: 'https://www.linkedin.com/jobs/view/1/',
            details: 'Actively recruiting',
          },
        ],
      }),
    );
    expect(text()).toContain('No job board you use lists this job.');
    const alerts = section('In job-alert emails')!;
    expect(text(alerts)).toContain('LinkedIn, sent 2 Oct 2026 · The job on LinkedIn');
    expect([...alerts.querySelectorAll('.details')].map((el) => text(el))).toEqual([
      'Subject: “engineer”: new jobs',
      'Actively recruiting',
    ]);
    expect(alerts.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.linkedin.com/jobs/view/1/',
    );
    expect(text(section('Job text')!)).toContain(
      'The app has only what a job-alert email showed about this job',
    );
    expect(section('Summary')).toBeUndefined();
  });

  it('asks for the link with the text of a job the alert email gave no link for', async () => {
    const alert = {
      catalogId: 'snaphunt_alert',
      name: 'Snaphunt',
      subject: 'Matching job: Backend Engineer at Acme',
      sentAt: '2026-10-02T07:12:00.000Z',
      firstSeenAt: '2026-10-02T08:00:00.000Z',
      url: null,
      details: '',
    };
    await load(detail({ sources: [], canImport: false, url: null, alerts: [alert] }));
    expect(page().querySelector('h1 + p a')).toBeNull();
    expect(text(section('In job-alert emails')!)).toContain(
      'The email links to the job only through its own tracker',
    );
    expect(text(section('Job text')!)).toContain('and no link to it');

    const [link, textarea] = [
      page().querySelector<HTMLInputElement>('input[type=url]')!,
      page().querySelector('textarea')!,
    ];
    textarea.value = 'Backend Engineer\n\nYou will build APIs.';
    textarea.dispatchEvent(new Event('input'));
    button('Save the text')!.click();
    await settle();
    http.expectNone(`/api/jobs/${jobId}/text`);
    expect(text(section('Job text')!)).toContain('Enter the link to the job page.');

    link.value = 'https://jobs.example.com/acme/1';
    link.dispatchEvent(new Event('input'));
    button('Save the text')!.click();
    await settle();
    const request = http.expectOne(`/api/jobs/${jobId}/text`);
    expect(request.request.body).toEqual({
      text: 'Backend Engineer\n\nYou will build APIs.',
      url: 'https://jobs.example.com/acme/1',
    });
    request.flush(
      detail({
        sources: [],
        canImport: false,
        url: 'https://jobs.example.com/acme/1',
        alerts: [alert],
        snapshot: snapshot({ catalogId: 'paste' }),
      }),
    );
    await settle();
    expect(page().querySelector('h1 + p a')?.getAttribute('href')).toBe(
      'https://jobs.example.com/acme/1',
    );
  });

  it('shows why pasted text was refused', async () => {
    await load(detail({ sources: [], canImport: false, saved: true }));
    const textarea = page().querySelector('textarea')!;
    textarea.value = 'Some text';
    textarea.dispatchEvent(new Event('input'));
    button('Save the text')!.click();
    await settle();
    http
      .expectOne(`/api/jobs/${jobId}/text`)
      .flush(
        { message: 'The job text is longer than 100000 characters.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(text(section('Job text')!)).toContain('The job text is longer than 100000 characters.');
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

  const matched: Match = {
    createdAt: '2026-10-02T09:00:00.000Z',
    model: 'deepseek-flash',
    costUsd: 0.0005,
    factsSent: 2,
    outdated: [],
  };

  const evidence = (fields: Partial<Evidence> = {}): Evidence => ({
    outcome: 'met',
    note: 'F1 says five years.',
    facts: [
      {
        versionId: '00000000-0000-4000-8000-000000000030',
        factId: '00000000-0000-4000-8000-000000000031',
        version: 2,
        body: 'Five years of Python at Acme.',
        current: true,
      },
    ],
    ...fields,
  });

  it('shows how the job fares against each criterion, and jumps to the quotes', async () => {
    const jd = 'You will build APIs.\n- 5+ years of   Python\nWe work in English.';
    await load(
      summarised(
        [requirement({ quote: '5+ years of Python' })],
        {
          verdict: 'to_confirm',
          criteria: [
            result({}),
            result({
              criterion: 'languages',
              reason: 'It is done in English.',
              quote: 'We work in English.',
            }),
            result({
              criterion: 'mustHaves',
              outcome: 'unknown',
              effect: 'to_confirm',
              reason: 'Not matched with your facts yet.',
            }),
          ],
        },
        { text: jd },
      ),
    );
    const criteria = section('Your criteria')!;
    expect(text(criteria)).toContain(
      'To confirm: the job does not say enough for a hard criterion. Change your criteria',
    );
    expect([...criteria.querySelectorAll('li')].map((li) => text(li))).toEqual([
      'Met Location: The location is in your search scope.',
      'Met Working language: It is done in English. Show in the job text',
      'Unknown Must-haves unknown: Not matched with your facts yet.',
    ]);
    const jdText = page().querySelector('details')!;
    expect(jdText.open).toBe(false);

    criteria.querySelector('button')!.click();
    await settle();
    expect(jdText.open).toBe(true);
    const mark = () => page().querySelector('mark')!;
    expect(text(mark())).toBe('We work in English.');
    expect(document.activeElement).toBe(mark());
    expect(page().querySelector('pre')!.textContent).toBe(jd);

    // A requirement's quote, found whatever the spacing in the text.
    page().querySelector<HTMLButtonElement>('[aria-label="Show Python in the job text"]')!.click();
    await settle();
    expect(mark().textContent).toBe('5+ years of   Python');
  });

  it('says when a quote is not in the current text', async () => {
    await load(
      summarised([], {
        criteria: [result({ criterion: 'languages', quote: 'We work in Swedish.' })],
      }),
    );
    section('Your criteria')!.querySelector('button')!.click();
    await settle();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'That quote is not in the current job text.',
    );
    expect(page().querySelector('mark')).toBeNull();
  });

  it('matches the job with the facts and shows what each requirement rests on', async () => {
    await load(summarised([requirement({})]));
    expect(text(section('Match with your facts')!)).toContain(
      'the 2 facts you allowed to go to DeepSeek, in one request; nothing else about you.',
    );

    button('Match with my facts')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/snapshots/${snapshotId}/match`);
    expect(request.request.method).toBe('POST');
    expect(text(page().querySelector(':scope > [role=status]'))).toBe(
      'Matching with your facts on DeepSeek. This can take a minute.',
    );
    request.flush(summarised([requirement({ evidence: evidence() })], {}, { match: matched }));
    await settle();
    http.expectOne('/api/model-usage').flush({ ...usage, calls: 4 });
    await settle();

    expect(listUnder('Must have')).toEqual([
      'Python “5+ years of Python” Met by your facts F1 says five years. Five years of Python at Acme. (fact version 2) Show in the job text Correct Remove',
    ]);
    const matchSection = section('Match with your facts')!;
    expect(text(matchSection)).toBe(
      'Match with your facts Matched by deepseek-flash on 2 Oct 2026 with 2 facts, about $0.0005. Each requirement above shows what it found.',
    );
    expect(button('Match again')).toBeUndefined();
  });

  it('offers to match again once the match is out of date', async () => {
    await load(
      summarised(
        [
          requirement({
            evidence: evidence({
              facts: evidence().facts.map((f) => ({ ...f, current: false })),
            }),
          }),
        ],
        {},
        {
          match: {
            ...matched,
            outdated: ['The facts that may be sent to DeepSeek have changed since.'],
          },
        },
      ),
    );
    expect(listUnder('Must have')[0]).toContain(
      'Met by your facts a fact it cites has changed, so it counts as unknown',
    );
    expect(listUnder('Must have')[0]).toContain('(fact version 2, not current)');
    expect(text(section('Match with your facts')!)).toContain(
      'The facts that may be sent to DeepSeek have changed since. Match again to use the change.',
    );
    button('Match again')!.click();
    http.expectOne(`/api/snapshots/${snapshotId}/match`).flush(summarised([requirement({})]));
    await settle();
    http.expectOne('/api/model-usage').flush(usage);
    await settle();
  });

  it('cannot match before any fact may be sent', async () => {
    await load(summarised([requirement({})], { factsToSend: 0 }));
    const matchSection = section('Match with your facts')!;
    expect(text(matchSection)).toContain('None of your facts may be sent yet.');
    expect(matchSection.querySelector('a')!.getAttribute('href')).toBe('/facts');
    expect(button('Match with my facts')!.disabled).toBe(true);
  });
  it('writes a draft for the job and opens it', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await load(
      detail({
        snapshot: snapshot({
          drafts: [
            {
              id: '00000000-0000-4000-8000-000000000020',
              kind: 'resume',
              createdAt: '2026-10-05T08:00:00.000Z',
              statements: 12,
              rejected: 2,
              outdated: ['The facts that may be used in drafts have changed since.'],
              pdfs: 1,
            },
          ],
        }),
      }),
    );
    const drafts = section('Drafts')!;
    expect(text(drafts)).toContain('the 1 fact you allowed both to go to DeepSeek');
    const items = [...drafts.querySelectorAll('li')].map((li) => text(li));
    expect(items[0]).toContain('Resume draft, written 5 Oct 2026');
    expect(items[0]).toContain('12 statements, 2 left out by the checks, 1 PDF kept.');
    expect(items[0]).toContain('The facts that may be used in drafts have changed since.');
    expect(items[1]).toContain('No cover letter draft yet.');
    expect(drafts.querySelector('a')!.getAttribute('href')).toBe(
      '/drafts/00000000-0000-4000-8000-000000000020',
    );
    expect(button('Write again')).toBeDefined();

    button('Write a cover letter')!.click();
    const request = http.expectOne(`/api/snapshots/${snapshotId}/drafts`);
    expect(request.request.body).toEqual({ kind: 'cover_letter' });
    await settle();
    expect(text(page().querySelector(':scope > [role=status]'))).toContain(
      'Writing the cover letter with DeepSeek.',
    );
    expect(button('Write again')!.disabled).toBe(true);
    request.flush({ id: '00000000-0000-4000-8000-000000000021' } as Draft);
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/drafts', '00000000-0000-4000-8000-000000000021']);
    http.expectOne('/api/model-usage').flush(usage);
  });

  it('says why no draft can be written yet, and shows a refusal', async () => {
    await load(detail({ factsToDraft: 0, snapshot: snapshot() }));
    const drafts = section('Drafts')!;
    expect(text(drafts)).toContain('None of your facts may be used yet.');
    expect(button('Write a resume')!.disabled).toBe(true);
  });

  it('shows the server’s message when writing fails', async () => {
    await load(detail({ snapshot: snapshot() }));
    button('Write a resume')!.click();
    http
      .expectOne(`/api/snapshots/${snapshotId}/drafts`)
      .flush(
        { message: 'DEEPSEEK_API_KEY is not set on the server, so drafts cannot be written.' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await settle();
    http.expectOne('/api/model-usage').flush(usage);
    await settle();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'DEEPSEEK_API_KEY is not set on the server, so drafts cannot be written.',
    );
  });

  it('has no drafts section before the app has the job text', async () => {
    await load(detail());
    expect(section('Drafts')).toBeUndefined();
  });
});
