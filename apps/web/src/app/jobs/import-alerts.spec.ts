import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  AlertEmailsResponse,
  CatalogEntry,
  ImportAlertEmailResponse,
  SourcesResponse,
} from '@jsa/shared';
import { ImportAlerts } from './import-alerts';

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

const linkedIn: CatalogEntry = {
  id: 'linkedin_alert',
  name: 'LinkedIn',
  access: 'email_alert',
  note: 'Made up.',
  terms: null,
  rateLimit: null,
  param: null,
  alert: { kind: 'job_alert', section: 'platforms', senders: ['a@example.com'], onByDefault: true },
};

const imported = (fields: Partial<ImportAlertEmailResponse>): ImportAlertEmailResponse => ({
  imported: true,
  reason: '',
  catalogId: 'linkedin_alert',
  sender: 'jobalerts-noreply@linkedin.com',
  subject: '“engineer”: new jobs',
  sentAt: '2026-10-02T07:12:00.000Z',
  again: false,
  jobs: [],
  unreadable: 0,
  ...fields,
});

const job = (n: number, fields: Partial<ImportAlertEmailResponse['jobs'][number]> = {}) => ({
  jobId: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Engineer ${n}`,
  company: 'Acme Oy',
  location: 'Helsinki',
  url: `https://www.linkedin.com/jobs/view/${n}/`,
  match: 'new' as const,
  onBoard: false,
  ...fields,
});

describe('ImportAlerts', () => {
  let fixture: ComponentFixture<ImportAlerts>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const results = () => page().querySelector('section[aria-labelledby=results-heading]');

  async function load(emails: AlertEmailsResponse['emails'] = []) {
    http.expectOne('/api/alert-emails').flush({ emails } satisfies AlertEmailsResponse);
    http
      .expectOne('/api/sources')
      .flush({ catalog: [linkedIn], sources: [], alerts: [] } satisfies SourcesResponse);
    await fixture.whenStable();
  }

  const paste = async (value: string) => {
    const area = page().querySelector('textarea')!;
    area.value = value;
    area.dispatchEvent(new Event('input'));
    area.dispatchEvent(new Event('blur'));
    page().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImportAlerts],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ImportAlerts);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('asks for an email before importing, and lists the emails imported before', async () => {
    await load([
      {
        id: '00000000-0000-4000-8000-000000000009',
        catalogId: 'linkedin_alert',
        subject: 'Old alert',
        sentAt: '2026-10-01T07:00:00.000Z',
        jobs: 3,
        unreadable: 0,
        lastImportedAt: '2026-10-02T08:00:00.000Z',
      },
    ]);
    expect(text(page().querySelector('section[aria-labelledby=recent-heading] li'))).toBe(
      'LinkedIn · Old alert · 3 jobs · sent 1 Oct 2026',
    );
    await paste('');
    expect(text(page().querySelector('[role=alert]'))).toBe('Paste an email’s source.');
  });

  it('imports a pasted email and shows each job read and what the app knew of it', async () => {
    await load();
    await paste('From: jobalerts-noreply@linkedin.com\n\nmade up');
    const request = http.expectOne({ method: 'POST', url: '/api/alert-emails' });
    expect(request.request.body).toEqual({
      message: 'From: jobalerts-noreply@linkedin.com\n\nmade up',
    });
    request.flush(
      imported({
        jobs: [job(1), job(2, { match: 'same_job', onBoard: true }), job(3, { match: 'address' })],
        unreadable: 1,
      }),
    );
    await settle();
    http.expectOne('/api/alert-emails').flush({ emails: [] });
    await fixture.whenStable();

    const shown = text(results());
    expect(shown).toContain('LinkedIn · “engineer”: new jobs · sent 2 Oct 2026');
    expect(shown).toContain(
      '3 jobs read: 1 new, 2 the app had already. 1 job in it could not be read.',
    );
    const items = [...results()!.querySelectorAll('li li')].map((li) => text(li));
    expect(items).toEqual([
      'Engineer 1 · Acme Oy · Helsinki New. Needs the job text: paste it, or save its page in the desktop app.',
      'Engineer 2 · Acme Oy · Helsinki The same company and title as a job the app had. Your job board lists it, so its text can be read there.',
      'Engineer 3 · Acme Oy · Helsinki The app had this job already. Needs the job text: paste it, or save its page in the desktop app.',
    ]);
    expect(results()!.querySelector('a')?.getAttribute('href')).toBe(
      '/jobs/00000000-0000-4000-8000-000000000001',
    );
    // The form is cleared for the next email.
    expect(page().querySelector('textarea')!.value).toBe('');
  });

  it('says why an email was not imported', async () => {
    await load();
    await paste('From: info@glassdoor.com\n\nmade up');
    http.expectOne({ method: 'POST', url: '/api/alert-emails' }).flush(
      imported({
        imported: false,
        catalogId: null,
        reason: 'It is from info@glassdoor.com, which is not a job-alert sender the app knows.',
      }),
    );
    await settle();
    http.expectOne('/api/alert-emails').flush({ emails: [] });
    await fixture.whenStable();
    expect(text(results())).toContain(
      'Unknown sender · “engineer”: new jobs · sent 2 Oct 2026 Not imported: It is from info@glassdoor.com',
    );

    await paste('not an email');
    http
      .expectOne({ method: 'POST', url: '/api/alert-emails' })
      .flush(
        { message: 'This is not an email’s full source.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    http.expectOne('/api/alert-emails').flush({ emails: [] });
    await fixture.whenStable();
    expect(text(results()!.querySelector('[role=alert]'))).toBe(
      'Not imported: This is not an email’s full source.',
    );
    // What could not be imported stays in the form.
    expect(page().querySelector('textarea')!.value).toBe('not an email');
  });

  it('imports uploaded files one after another', async () => {
    await load();
    const input = page().querySelector<HTMLInputElement>('input[type=file]')!;
    const files = [
      new File(['From: a@example.com\n\none'], 'first.eml', { type: 'message/rfc822' }),
      new File(['From: a@example.com\n\ntwo'], 'second.eml', { type: 'message/rfc822' }),
    ];
    Object.defineProperty(input, 'files', { value: files });
    input.dispatchEvent(new Event('change'));
    await settle();

    const first = http.expectOne({ method: 'POST', url: '/api/alert-emails' });
    expect(first.request.body).toEqual({ message: 'From: a@example.com\n\none' });
    first.flush(imported({ jobs: [job(1)] }));
    await settle();
    const second = http.expectOne({ method: 'POST', url: '/api/alert-emails' });
    expect(second.request.body).toEqual({ message: 'From: a@example.com\n\ntwo' });
    second.flush(imported({ again: true, jobs: [job(1, { match: 'address' })] }));
    await settle();
    http.expectOne('/api/alert-emails').flush({ emails: [] });
    await fixture.whenStable();

    const labels = [...results()!.querySelectorAll('.outcomes > li > strong')].map((el) =>
      text(el),
    );
    expect(labels).toEqual(['first.eml', 'second.eml']);
    expect(text(results())).toContain('This email was imported before.');
  });
});
