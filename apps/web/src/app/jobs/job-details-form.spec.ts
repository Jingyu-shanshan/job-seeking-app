import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { JobDetail } from '@jsa/shared';
import { JobDetailsForm } from './job-details-form';

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('JobDetailsForm', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(JobDetailsForm);
    fixture.componentRef.setInput('job', {
      id: 'job-1',
      title: 'Engineer',
      company: 'Acme',
      location: 'Helsinki',
      url: 'https://example.com/job',
    } as JobDetail);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const http = TestBed.inject(HttpTestingController);
    const input = (label: string) =>
      [...page.querySelectorAll('label')]
        .find((el) => el.textContent!.trim().startsWith(label))!
        .querySelector('input')!;
    const fill = (label: string, value: string) => {
      const el = input(label);
      el.value = value;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('blur'));
    };
    const save = async () => {
      page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      await settle();
    };
    return { fixture, page, http, input, fill, save };
  }
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('retains edits on failure, prevents duplicate saves and supports retry', async () => {
    const { page, http, fill, save, input } = setup();
    fill('Company', 'Acme Oy');
    await settle();
    await save();
    const first = http.expectOne('/api/jobs/job-1/details');
    expect(first.request.body.company).toBe('Acme Oy');
    expect(page.querySelector('fieldset')!.disabled).toBe(true);
    await save();
    http.expectNone('/api/jobs/job-1/details');
    first.flush({ message: 'Try again.' }, { status: 500, statusText: 'Failure' });
    await settle();
    expect(input('Company').value).toBe('Acme Oy');
    expect(page.querySelector('[role=alert]')!.textContent).toContain('Try again.');
    await save();
    http.expectOne('/api/jobs/job-1/details').flush({ id: 'job-1' });
    await settle();
  });

  it.each(['http://example.com/job', 'https://user:secret@example.com/job'])(
    'rejects unsafe URL %s before saving',
    async (url) => {
      const { http, fill, save } = setup();
      fill('Job link', url);
      await settle();
      await save();
      http.expectNone('/api/jobs/job-1/details');
    },
  );

  it('rejects whitespace titles before saving', async () => {
    const { http, fill, save } = setup();
    fill('Job title', '   ');
    await settle();
    await save();
    http.expectNone('/api/jobs/job-1/details');
  });
});
