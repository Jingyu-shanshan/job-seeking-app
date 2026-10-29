import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { JobDetail } from '@jsa/shared';
import { PasteJob } from './paste-job';

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('PasteJob', () => {
  let fixture: ComponentFixture<PasteJob>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const field = (label: string) =>
    [...page().querySelectorAll('label')]
      .find((l) => l.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
  const fill = (label: string, value: string) => {
    const el = field(label);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('blur'));
  };
  const alerts = () =>
    [...page().querySelectorAll('[role=alert]')].map((el) => el.textContent?.trim());
  const submit = async () => {
    page().querySelector<HTMLButtonElement>('form:has(textarea) button[type=submit]')!.click();
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PasteJob],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(PasteJob);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('asks for a title, an https link and the text before saving', async () => {
    fill('Link to the job page', 'http://example.com/jobs/1');
    await submit();
    expect(alerts()).toEqual([
      'Enter the job title.',
      'Enter an https link.',
      'Paste the job text.',
    ]);
  });

  it.each(['https://careers.example.com/jobs/1', 'https://www.linkedin.com/jobs/view/123'])(
    'saves manually pasted text from %s and opens it',
    async (url) => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill('Job title', ' Billing Engineer ');
      fill('Location', 'Helsinki');
      fill('Link to the job page', url);
      fill('Job text', 'You keep invoices correct.');
      await submit();

      const request = http.expectOne('/api/jobs');
      expect(request.request.body).toEqual({
        title: 'Billing Engineer',
        url,
        text: 'You keep invoices correct.',
        location: 'Helsinki',
      });
      request.flush({ id: '00000000-0000-4000-8000-000000000001' } as JobDetail);
      await settle();
      expect(navigate).toHaveBeenCalledWith(['/jobs', '00000000-0000-4000-8000-000000000001']);
    },
  );

  it('offers existing job links and creates another only after confirmation', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fill('Job title', 'Engineer');
    fill('Link to the job page', 'https://example.com/job');
    fill('Job text', 'Original job text.');
    await submit();
    http.expectOne('/api/jobs').flush(
      {
        code: 'duplicate_job',
        message: 'This job is already added.',
        jobs: [{ id: 'job-1', title: 'Engineer', company: 'Acme', location: 'Helsinki' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(page().textContent).toContain('This job is already added.');
    expect(page().querySelector('a[href="/jobs/job-1"]')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone(() => true);
    [...page().querySelectorAll('button')]
      .find((b) => b.textContent!.includes('Create another imported job'))!
      .click();
    await settle();
    const confirmed = http.expectOne('/api/jobs');
    expect(confirmed.request.body.createNew).toBe(true);
    confirmed.flush({ id: 'job-2' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/jobs', 'job-2']);
  });

  it('clears duplicate confirmation when any input changes', async () => {
    fill('Job title', 'Engineer');
    fill('Link to the job page', 'https://example.com/job');
    fill('Job text', 'Original text.');
    await submit();
    http.expectOne('/api/jobs').flush(
      {
        code: 'duplicate_job',
        message: 'This job is already added.',
        jobs: [{ id: 'job-1', title: 'Engineer', company: null, location: '' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    fill('Location', 'Espoo');
    await settle();
    expect(page().textContent).not.toContain('Create another imported job');
    await submit();
    const request = http.expectOne('/api/jobs');
    expect(request.request.body.createNew).toBeUndefined();
    request.flush({ id: 'job-3' });
    await settle();
  });

  it('retains confirmation after an explicit create fails and prevents duplicate clicks', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fill('Job title', 'Engineer');
    fill('Link to the job page', 'https://example.com/job');
    fill('Job text', 'Original text.');
    await submit();
    http.expectOne('/api/jobs').flush(
      {
        code: 'duplicate_job',
        jobs: [{ id: 'job-1', title: 'Engineer', company: null, location: '' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    const confirm = () =>
      [...page().querySelectorAll('button')].find((b) =>
        b.textContent!.includes('Create another imported job'),
      )!;
    confirm().click();
    await settle();
    const first = http.expectOne('/api/jobs');
    expect(confirm().disabled).toBe(true);
    confirm().click();
    await settle();
    http.expectNone('/api/jobs');
    first.flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(confirm()).toBeDefined();
    expect(field('Job text').value).toBe('Original text.');
    confirm().click();
    await settle();
    const retry = http.expectOne('/api/jobs');
    expect(retry.request.body.createNew).toBe(true);
    retry.flush({ id: 'job-2' });
    await settle();
  });

  it('shows the server’s reason when saving fails', async () => {
    fill('Job title', 'Engineer');
    fill('Link to the job page', 'https://careers.example.com/jobs/1');
    fill('Job text', 'Text.');
    await submit();
    http
      .expectOne('/api/jobs')
      .flush({ message: 'Paste the job text.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(alerts()).toEqual(['Paste the job text.']);
    expect(field('Job title').value).toBe('Engineer');
    expect(field('Job text').value).toBe('Text.');
    expect(field('Link to the job page').value).toBe('https://careers.example.com/jobs/1');
    await submit();
    const retry = http.expectOne('/api/jobs');
    expect(retry.request.body.text).toBe('Text.');
    retry.flush({ message: 'Still unavailable.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
  });
});
