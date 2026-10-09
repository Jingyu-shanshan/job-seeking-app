import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ApplicationSummary, JobApplications } from '@jsa/shared';
import { JobApplicationsView } from './job-applications';

const jobId = '00000000-0000-4000-8000-000000000001';
const pdfId = '00000000-0000-4000-8000-000000000002';
const applicationId = '00000000-0000-4000-8000-000000000003';

const state = (s: Partial<JobApplications> = {}): JobApplications => ({
  applications: [],
  cannotRecord: null,
  pdfs: [
    {
      id: pdfId,
      kind: 'resume',
      fileName: 'Test Person - Resume.pdf',
      createdAt: '2026-10-08T09:00:00.000Z',
      sha256: 'ab'.repeat(32),
    },
  ],
  ...s,
});

const recorded: ApplicationSummary = {
  id: applicationId,
  jobId,
  title: 'Billing engineer',
  company: 'Example Oy',
  status: 'submitted',
  method: 'manual',
  createdAt: '2026-10-09T10:00:00.000Z',
  submittedAt: '2026-10-08T15:30:00.000Z',
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('JobApplicationsView', () => {
  let fixture: ComponentFixture<JobApplicationsView>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => text(b) === label);
  const input = (selector: string) => page().querySelector<HTMLInputElement>(selector)!;
  const type = (el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JobApplicationsView],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(JobApplicationsView);
    fixture.componentRef.setInput('jobId', jobId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  async function load(s: JobApplications) {
    http.expectOne(`/api/jobs/${jobId}/applications`).flush(s);
    await fixture.whenStable();
  }

  it('says that drafts and PDFs do not count, and why one cannot be recorded', async () => {
    await load(
      state({
        cannotRecord:
          'Save or paste the job’s text first: the record keeps the text you applied to.',
      }),
    );
    expect(text()).toContain('No application yet. Writing drafts, printing PDFs or opening');
    expect(text()).toContain('Save or paste the job’s text first');
    expect(button('I applied outside the app')).toBeUndefined();
  });

  it('records one sent outside the app, with a kept PDF and the file as sent', async () => {
    let told = 0;
    fixture.componentInstance.recorded.subscribe(() => told++);
    await load(state());
    button('I applied outside the app')!.click();
    await fixture.whenStable();
    expect(text()).toContain('Test Person - Resume.pdf (resume, kept 8 Oct 2026');

    type(input('input[type="datetime-local"]'), '2026-10-08T15:30');
    type(input('input[type="text"]'), 'Through the company’s site');
    input('input[type="checkbox"]').click();
    const file = input('input[type="file"]');
    const sent = new File(['%PDF-1.4 as sent'], 'Resume as sent.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(file, 'files', { value: [sent] });
    file.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    button('Record the application')!.click();
    await settle();
    const request = http.expectOne(`/api/jobs/${jobId}/applications`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      submittedAt: new Date('2026-10-08T15:30').toISOString(),
      note: 'Through the company’s site',
      documentPdfIds: [pdfId],
      files: [{ fileName: 'Resume as sent.pdf', body: btoa('%PDF-1.4 as sent') }],
    });
    request.flush(
      state({
        applications: [recorded],
        cannotRecord: 'This job’s application went in already.',
      }),
    );
    await settle();
    await fixture.whenStable();
    expect(told).toBe(1);
    const link = page().querySelector('li a')!;
    expect(text(link)).toBe('Applied');
    expect(link.getAttribute('href')).toBe(`/applications/${applicationId}`);
    expect(text()).toContain('sent outside the app');
    expect(text()).toContain('This job’s application went in already.');
    expect(page().querySelector('form')).toBeNull();
  });

  it('refuses a time in the future and too large a file before sending anything', async () => {
    await load(state());
    button('I applied outside the app')!.click();
    await fixture.whenStable();
    type(input('input[type="datetime-local"]'), '2999-01-01T00:00');
    const file = input('input[type="file"]');
    const big = new File(['x'], 'Huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    Object.defineProperty(file, 'files', { value: [big], configurable: true });
    file.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(text()).toContain('Huge.pdf is larger than 2 MiB.');
    expect(button('Record the application')!.disabled).toBe(true);
    Object.defineProperty(file, 'files', { value: [], configurable: true });
    file.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    button('Record the application')!.click();
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('The time you sent it is in the future.');
    http.expectNone(`/api/jobs/${jobId}/applications`);
  });

  it('after a refused file, sends again with another one', async () => {
    await load(state());
    button('I applied outside the app')!.click();
    await fixture.whenStable();
    const file = input('input[type="file"]');
    const choose = (body: string) => {
      const chosen = new File([body], 'Sent.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'files', { value: [chosen], configurable: true });
      file.dispatchEvent(new Event('change'));
    };
    choose('%PDF-1.4 the same as the kept one');
    button('Record the application')!.click();
    await settle();
    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { message: 'The same file is given twice: Sent.pdf.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    http.expectOne((r) => r.method === 'GET').flush(state());
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('The same file is given twice: Sent.pdf.');

    choose('%PDF-1.4 edited before sending');
    button('Record the application')!.click();
    await settle();
    const again = http.expectOne((r) => r.method === 'POST');
    expect(again.request.body.files).toEqual([
      { fileName: 'Sent.pdf', body: btoa('%PDF-1.4 edited before sending') },
    ]);
    again.flush(state({ applications: [recorded], cannotRecord: 'Went in already.' }));
    await settle();
    await fixture.whenStable();
    expect(text()).not.toContain('The same file is given twice');
  });

  it('shows the server’s refusal and asks again', async () => {
    await load(state());
    button('I applied outside the app')!.click();
    await fixture.whenStable();
    button('Record the application')!.click();
    await settle();
    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { message: 'Close the runner’s fill of this job’s form first.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    http
      .expectOne((r) => r.method === 'GET')
      .flush(state({ cannotRecord: 'Close the runner’s fill of this job’s form first.' }));
    await settle();
    await fixture.whenStable();
    expect(text()).toContain('Close the runner’s fill of this job’s form first.');
  });
});
