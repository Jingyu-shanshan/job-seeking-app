import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ImportJobLink } from './import-job-link';

describe('ImportJobLink', () => {
  let fixture: ComponentFixture<ImportJobLink>;
  let http: HttpTestingController;
  const job = { id: 'job-1', title: 'Engineer', snapshot: { id: 'snapshot-1', summary: null } };
  const page = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };
  const fill = async (url: string) => {
    const input = page().querySelector('input')!;
    input.value = url;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  };
  const submit = async () => {
    page().querySelector<HTMLButtonElement>('button')!.click();
    await settle();
  };
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ImportJobLink);
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });
  afterEach(() => http.verify());

  it('validates links before making requests', async () => {
    await fill('http://example.test/job');
    await submit();
    expect(page().textContent).toContain('Enter an https link.');
    http.expectNone(() => true);
  });

  it.each([
    ['https://fi.linkedin.com/jobs/view/123', 'LinkedIn does not permit automated scraping'],
    [
      'https://duunitori.fi/tyopaikat/tyo/example',
      'permission for automated access has not been established',
    ],
    ['https://www.jobly.fi/tyopaikka/example', 'Jobly link import is not supported yet'],
  ])(
    'explains %s immediately, blocks submission and clears the error for a supported link',
    async (url, reason) => {
      const input = page().querySelector('input')!;
      input.value = url;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(page().querySelector('#job-link-error')?.textContent).toContain(reason);
      expect(page().querySelector('#job-link-error')?.textContent).toContain(
        'Paste the job text below',
      );
      expect(page().querySelector('button')!.disabled).toBe(true);
      expect(input.getAttribute('aria-describedby')).toContain('job-link-error');
      page()
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();
      http.expectNone(() => true);
      await fill('https://boards.greenhouse.io/acme/jobs/1');
      expect(page().querySelector('#job-link-error')).toBeNull();
      expect(page().querySelector('button')!.disabled).toBe(false);
    },
  );

  it('removes an old server error when the link changes', async () => {
    await fill('https://boards.greenhouse.io/acme/jobs/1');
    await submit();
    http
      .expectOne('/api/jobs/import-link')
      .flush({ message: 'Previous read failed.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(page().textContent).toContain('Previous read failed.');
    await fill('https://www.linkedin.com/jobs/view/123');
    expect(page().textContent).not.toContain('Previous read failed.');
    expect(page().querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it('imports the original text, then analyses only that snapshot and opens the saved job', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fill('https://careers.example.com/jobs/1');
    await submit();
    expect(page().textContent).toContain('public company job page');
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    const imported = http.expectOne('/api/jobs/import-link');
    expect(imported.request.body).toEqual({ url: 'https://careers.example.com/jobs/1' });
    imported.flush(job);
    await settle();
    const analysis = http.expectOne('/api/snapshots/snapshot-1/summary');
    expect(analysis.request.body).toEqual({});
    analysis.flush({ ...job, snapshot: { ...job.snapshot, summary: {} } });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/jobs', 'job-1']);
  });

  it('keeps the imported job after AI failure, retries analysis without reimporting and resets for a new link', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fill('https://boards.greenhouse.io/acme/jobs/1');
    await submit();
    http.expectOne('/api/jobs/import-link').flush(job);
    await settle();
    http
      .expectOne('/api/snapshots/snapshot-1/summary')
      .flush({ message: 'Analysis unavailable.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(page().textContent).toContain('Analysis unavailable.');
    expect(page().querySelector('a')?.getAttribute('href')).toBe('/jobs/job-1');
    expect(page().querySelector('button')?.textContent).toContain('Retry analysis');
    await submit();
    http.expectNone('/api/jobs/import-link');
    http
      .expectOne('/api/snapshots/snapshot-1/summary')
      .flush({ ...job, snapshot: { ...job.snapshot, summary: {} } });
    await settle();
    await fill('https://boards.greenhouse.io/acme/jobs/2');
    await submit();
    http
      .expectOne('/api/jobs/import-link')
      .flush({ message: 'Job not available.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    http.expectNone('/api/snapshots/snapshot-1/summary');
    expect(page().querySelector('input')?.value).toContain('/jobs/2');
  });

  it('opens an existing analysed job without another model call', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fill('https://boards.greenhouse.io/acme/jobs/1');
    await submit();
    http
      .expectOne('/api/jobs/import-link')
      .flush({ ...job, snapshot: { ...job.snapshot, summary: {} } });
    await settle();
    http.expectNone('/api/snapshots/snapshot-1/summary');
    expect(navigate).toHaveBeenCalledWith(['/jobs', 'job-1']);
  });
});
