import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ApplicationRecord, ApplicationsResponse } from '@jsa/shared';
import { ApplicationPage } from './application-page';
import { Applications } from './applications';

const id = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const draftId = '00000000-0000-4000-8000-000000000003';

const record = (r: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id,
  jobId,
  title: 'Platform Engineer',
  company: 'Acme',
  status: 'submitted',
  method: 'runner',
  createdAt: '2026-10-08T09:05:00.000Z',
  submittedAt: '2026-10-08T09:05:00.000Z',
  note: '',
  job: {
    snapshotId: '00000000-0000-4000-8000-000000000004',
    title: 'Platform Engineer',
    company: 'Acme',
    location: 'Helsinki, Finland',
    url: 'https://job-boards.greenhouse.io/acme/jobs/7',
    capturedAt: '2026-10-07T08:00:00.000Z',
    text: 'You build the platform. Made up.',
  },
  match: {
    id: '00000000-0000-4000-8000-000000000005',
    createdAt: '2026-10-07T08:30:00.000Z',
    verdict: 'eligible',
    requirements: [
      { kind: 'must', text: 'Backend experience', outcome: 'met', note: 'Your role shows it.' },
    ],
  },
  files: [
    {
      id: '00000000-0000-4000-8000-000000000006',
      label: 'Resume/CV',
      fileName: 'Test Person - Resume.pdf',
      bytes: 40_000,
      sha256: 'ab'.repeat(32),
      draft: { id: draftId, kind: 'resume' },
      url: '/api/application-files/00000000-0000-4000-8000-000000000006',
    },
  ],
  facts: [
    {
      factVersionId: '00000000-0000-4000-8000-000000000007',
      factId: '00000000-0000-4000-8000-000000000008',
      kind: 'experience',
      version: 1,
      text: 'Backend developer at Acme Oy, 2021-03 – 2024-06',
      stillCurrent: false,
    },
  ],
  form: {
    approvedAt: '2026-10-08T09:00:00.000Z',
    fields: [
      { label: 'First Name', value: ['Test'] },
      { label: 'Gender', value: [] },
    ],
    screenshotUrl: '/api/fill-checks/c1/screenshot',
  },
  receipt: {
    confirmed: true,
    pageUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=7',
    pageText: 'Thank you for applying to Acme!',
    note: '',
    checkedAt: '2026-10-08T09:05:03.000Z',
    screenshotUrl: '/api/submit-receipts/r1/screenshot',
  },
  ...r,
});

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('ApplicationPage', () => {
  let fixture: ComponentFixture<ApplicationPage>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ApplicationPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(ApplicationPage);
    fixture.componentRef.setInput('id', id);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(r: ApplicationRecord) {
    http.expectOne(`/api/applications/${id}`).flush(r);
    await fixture.whenStable();
  }

  it('shows what the runner’s application kept, and the facts that changed since', async () => {
    await load(record());
    const all = text(page());
    expect(text(page().querySelector('h1'))).toBe('Platform Engineer');
    expect(all).toContain('Applied · via the runner.');
    expect(all).toContain('Resume/CV: Test Person - Resume.pdf (39 KB)');
    expect(all).toContain('Current resume document (may have changed)');
    expect(page().querySelector('a[href="' + record().files[0].url + '"]')).not.toBeNull();
    expect(all).toContain(`SHA-256 ${'ab'.repeat(32)}`);
    expect(page().querySelector('a[href="/drafts/' + draftId + '/document"]')).not.toBeNull();
    expect(all).toContain('Experience, version 1: Backend developer at Acme Oy, 2021-03 – 2024-06');
    expect(all).toContain('This fact has changed or been withdrawn since.');
    expect(all).toContain('First Name: Test');
    expect(all).toContain('Gender: empty');
    expect(all).toContain('Thank you for applying to Acme!');
    expect(all).toContain('your facts met every must-have');
    expect(all).toContain('Must have: Backend experience — Met.');
    expect(all).toContain('You build the platform. Made up.');
  });

  it('one sent outside the app: when it was sent, the note and the uploaded file', async () => {
    await load(
      record({
        method: 'manual',
        createdAt: '2026-10-09T10:00:00.000Z',
        submittedAt: '2026-10-08T15:30:00.000Z',
        note: 'Through the company’s site',
        files: [
          {
            id: '00000000-0000-4000-8000-000000000009',
            label: '',
            fileName: 'Resume as sent.pdf',
            bytes: 2_500_000,
            sha256: 'cd'.repeat(32),
            draft: null,
            url: '/api/application-files/00000000-0000-4000-8000-000000000009',
          },
        ],
        facts: [],
        form: null,
        receipt: null,
        match: null,
      }),
    );
    const all = text(page());
    expect(all).toContain('Applied · sent outside the app. You sent it on 8 Oct 2026');
    expect(all).toContain('Through the company’s site');
    expect(all).toContain('Resume as sent.pdf (2.4 MB) External PDF uploaded as sent.');
    expect(all).toContain('No runner approval exists.');
    expect(all).toContain('No runner receipt exists');
    expect(all).toContain('External PDF uploads do not add fact references.');
    expect(all).toContain('The job’s text had not been matched with your facts.');
    expect(all).not.toContain('The form as you approved it');
  });

  it.each(['to_verify', 'not_submitted'] as const)(
    'keeps %s separate from successful applications and does not offer interview preparation',
    async (status) => {
      await load(record({ status, submittedAt: null, receipt: null, files: [] }));
      expect(page().querySelector('a[href$="/interview"]')).toBeNull();
      expect(text(page())).toContain('Files recorded for this attempt');
      expect(text(page())).toContain('No files were recorded');
      expect(text(page())).toContain('No receipt was recorded');
      const verify = page().querySelector('a[href$="#application-heading"]');
      if (status === 'to_verify') {
        expect(text(verify)).toBe('Verify on the job page');
        expect(text(page())).toContain('result is unknown');
      } else {
        expect(verify).toBeNull();
        expect(text(page())).toContain('does not count as applied');
      }
      expect(page().querySelector('button')).toBeNull();
    },
  );

  it('keeps a later user verification distinct from an unconfirmed receipt', async () => {
    await load(record({ receipt: { ...record().receipt!, confirmed: false } }));
    expect(text(page())).toContain('This application is recorded as applied.');
    expect(text(page())).toContain('no confirmation observed');
    expect(page().querySelector('a[href$="/interview"]')).not.toBeNull();
  });

  it('shows loading and a retriable load error', async () => {
    expect(text(page().querySelector('[role=status]'))).toContain('Loading the application');
    http
      .expectOne(`/api/applications/${id}`)
      .flush({ message: 'Sample unavailable.' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toContain('Sample unavailable.');
    page().querySelector('button')!.click();
    TestBed.tick();
    await load(record());
    expect(text(page().querySelector('h1'))).toBe('Platform Engineer');
  });

  it('explains a missing record and keeps the return link', async () => {
    http
      .expectOne(`/api/applications/${id}`)
      .flush({ message: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toContain('could not be found');
    expect(page().querySelector('a[href="/applications"]')).not.toBeNull();
    expect(page().querySelector('button')).toBeNull();
  });
});

describe('Applications', () => {
  let fixture: ComponentFixture<Applications>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Applications],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Applications);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('lists all three results and labels attempted and submitted times accurately', async () => {
    const response: ApplicationsResponse = {
      applications: [
        { ...record(), status: 'to_verify', submittedAt: null },
        { ...record(), id: jobId, status: 'not_submitted', submittedAt: null, company: null },
        { ...record(), id: draftId, method: 'manual' },
      ],
    };
    http.expectOne('/api/applications').flush(response);
    await fixture.whenStable();
    const items = [...page().querySelectorAll('li')].map(text);
    expect(items[0]).toContain('Result unknownPlatform EngineerAcme · via the runner');
    expect(items[0]).toContain('Submit attempted');
    expect(items[1]).toContain('Did not go throughPlatform EngineerCompany not given');
    expect(items[2]).toContain('AppliedPlatform EngineerAcme · sent outside the app Submitted');
    expect(page().querySelectorAll('a[href$="#application-heading"]')).toHaveLength(1);
    expect(page().querySelectorAll('.applied')).toHaveLength(1);
  });

  it('offers a real next step when no applications have been recorded', async () => {
    http.expectOne('/api/applications').flush({ applications: [] });
    await fixture.whenStable();
    expect(text(page())).toContain('No applications recorded');
    expect(text(page())).toContain('draft does not count as applying');
    expect(text(page().querySelector('a[href="/jobs"]'))).toBe('Choose a job');
  });

  it('shows loading and retries a failed read', async () => {
    expect(text(page().querySelector('[role=status]'))).toContain('Loading applications');
    http
      .expectOne('/api/applications')
      .flush({ message: 'Sample read failed.' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toContain('Sample read failed.');
    page().querySelector('button')!.click();
    TestBed.tick();
    http.expectOne('/api/applications').flush({ applications: [] });
    await fixture.whenStable();
    expect(text(page())).toContain('No applications recorded');
  });
});
