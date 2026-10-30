import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { JobSearchResponse } from '@jsa/shared';
import { SearchJobs } from './search-jobs';

const candidate = {
  title: 'Search title',
  url: 'https://job-boards.greenhouse.io/acme/jobs/11',
  source: 'greenhouse_board' as const,
  snippet: '<img src=x onerror=alert(1)> Helsinki, everything confirmed',
};
const searchResult: JobSearchResponse = {
  id: 'request-id',
  query: '"Engineer" "Helsinki" site:job-boards.greenhouse.io',
  createdAt: '2026-10-23T10:00:00Z',
  costUsd: 0.00075,
  estimated: false,
  message: 'Completed.',
  candidates: [candidate],
  ignored: [{ title: 'Unwanted result', reason: 'Not from your selected sources.' }],
};

describe('Search for job links', () => {
  let fixture: ComponentFixture<SearchJobs>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };
  const button = (text: string) =>
    Array.from(page().querySelectorAll('button')).find((b) => b.textContent?.includes(text))!;
  const fillRole = async (value = 'Engineer') => {
    const input = page().querySelector<HTMLInputElement>('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  };
  const submit = async () => {
    button('Search with DeepSeek').click();
    await settle();
  };
  const finishSearch = async () => {
    await fillRole();
    await submit();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/job-searches');
    req.flush({ ...searchResult, id: req.request.body.id });
    await settle();
  };
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(SearchJobs);
    http = TestBed.inject(HttpTestingController);
    await settle();
    http.expectOne('/api/job-searches').flush({ available: true, estimatedCostUsd: 0.00075 });
    await settle();
  });
  afterEach(() => http.verify());

  it('quotes the fee and requests no searches, official pages or models on load', () => {
    expect(page().textContent).toContain('0.00075');
    expect(page().querySelectorAll('input')[1].value).toBe('Helsinki');
    http.expectNone(() => true);
  });
  it('requires a role and at least one explicitly selected source', async () => {
    await submit();
    expect(page().textContent).toContain('Enter a role.');
    await fillRole();
    for (const input of page().querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
      input.click();
    }
    await settle();
    await submit();
    expect(page().textContent).toContain('Choose Greenhouse or Ashby.');
    http.expectNone((r) => r.method === 'POST');
  });
  it('submits only explicit search terms, selected sources and approved cost, then shows unverified links', async () => {
    await fillRole();
    page().querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1].click();
    await settle();
    await submit();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({
      id: expect.any(String),
      role: 'Engineer',
      location: 'Helsinki',
      sources: ['greenhouse_board'],
      maxCostUsd: 0.00075,
    });
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    req.flush(searchResult);
    await settle();
    expect(page().textContent).toContain('Search snippet · not verified');
    expect(page().textContent).toContain('Not from your selected sources.');
    expect(page().querySelector('img')).toBeNull();
    expect(page().querySelector('article a')).toBeNull();
    http.expectNone(() => true);
  });
  it('verifies only the selected link, saves official text and shows the actual criterion verdict', async () => {
    await finishSearch();
    button('Verify and save job').click();
    await settle();
    const req = http.expectOne('/api/jobs/import-link');
    expect(req.request.body).toEqual({ url: candidate.url });
    expect(button('Verifying…').disabled).toBe(true);
    req.flush({ id: 'saved-job', title: 'Official title', location: '', verdict: 'to_confirm' });
    await settle();
    expect(page().textContent).toContain('Verified and saved: Official title');
    expect(page().textContent).toContain('Location unknown');
    expect(page().textContent).toContain('Criteria to confirm');
    expect(page().querySelector('article a')?.getAttribute('href')).toBe('/jobs/saved-job');
    http.expectNone((r) => r.url.includes('/summary') || r.url.includes('/sources'));
  });
  it('shows duplicate links without analysis and confirms only the selected candidate', async () => {
    await finishSearch();
    button('Verify and save job').click();
    await settle();
    http.expectOne('/api/jobs/import-link').flush(
      {
        code: 'duplicate_job',
        message: 'This job is already added.',
        jobs: [{ id: 'job-1', title: 'Engineer', company: null, location: '' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(page().querySelector('a[href="/jobs/job-1"]')).not.toBeNull();
    http.expectNone(() => true);
    button('Create another imported job').click();
    await settle();
    const request = http.expectOne('/api/jobs/import-link');
    expect(request.request.body).toEqual({ url: candidate.url, createNew: true });
    request.flush({ id: 'job-2', title: 'Engineer', location: '', verdict: 'to_confirm' });
    await settle();
    expect(page().querySelector('a[href="/jobs/job-2"]')).not.toBeNull();
    http.expectNone((request) => request.url.includes('/summary'));
  });

  it('keeps confirmation scoped to its candidate and preserves it after a failed create', async () => {
    await finishSearch();
    const other = { ...candidate, url: 'https://job-boards.greenhouse.io/acme/jobs/22' };
    fixture.componentInstance['result'].set({ ...searchResult, candidates: [candidate, other] });
    await settle();
    const articles = () => [...page().querySelectorAll('article')];
    articles()[0].querySelector('button')!.click();
    await settle();
    http.expectOne('/api/jobs/import-link').flush(
      {
        code: 'duplicate_job',
        jobs: [{ id: 'job-1', title: 'Engineer', company: null, location: '' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    articles()[1].querySelector('button')!.click();
    await settle();
    const second = http.expectOne('/api/jobs/import-link');
    expect(second.request.body).toEqual({ url: other.url });
    second.flush({ message: 'Unavailable.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    button('Create another imported job').click();
    await settle();
    const forced = http.expectOne('/api/jobs/import-link');
    expect(forced.request.body).toEqual({ url: candidate.url, createNew: true });
    forced.flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(button('Create another imported job')).toBeDefined();
  });

  it('retains candidate results and input on an expired job and retries verification without another search', async () => {
    await finishSearch();
    button('Verify and save job').click();
    await settle();
    http
      .expectOne('/api/jobs/import-link')
      .flush(
        { message: 'The board no longer lists this job.' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await settle();
    expect(page().textContent).toContain('no longer lists this job');
    expect(page().textContent).toContain('Search title');
    expect(page().querySelector<HTMLInputElement>('input')!.value).toBe('Engineer');
    button('Retry verification and save').click();
    await settle();
    http.expectOne('/api/jobs/import-link').flush({
      id: 'saved-job',
      title: 'Official title',
      location: 'Berlin',
      verdict: 'ineligible',
    });
    await settle();
    expect(page().textContent).toContain('Ruled out by hard criteria');
    http.expectNone((r) => r.url === '/api/job-searches');
  });
  it('retries a lost search with the same ID and leaves previous results visible', async () => {
    await finishSearch();
    await submit();
    const req = http.expectOne('/api/job-searches');
    const original = req.request.body;
    req.error(new ProgressEvent('error'));
    await settle();
    expect(page().textContent).toContain('Search title');
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    button('Retry / check same search').click();
    await settle();
    const retry = http.expectOne('/api/job-searches');
    expect(retry.request.body).toEqual(original);
    retry.flush({
      ...searchResult,
      candidates: [],
      ignored: [],
      estimated: true,
      message: 'Outcome unknown; estimate retained.',
    });
    await settle();
    expect(page().textContent).toContain('Estimated / reserved');
    expect(page().textContent).toContain('No candidate job links');
    expect(page().querySelector('fieldset')!.disabled).toBe(false);
  });
  it('allows correction after a confirmed pre-send failure while keeping the last results', async () => {
    await finishSearch();
    await fillRole('x'.repeat(60));
    await submit();
    http
      .expectOne('/api/job-searches')
      .flush(
        { message: 'Shorten the role or location.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(page().textContent).toContain('Search title');
    expect(page().textContent).toContain('Shorten the role or location.');
    expect(page().querySelector('fieldset')!.disabled).toBe(false);
  });
});
