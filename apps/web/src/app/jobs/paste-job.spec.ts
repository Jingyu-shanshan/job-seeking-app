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
    page().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
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

  it('saves the job and opens it', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fill('Job title', ' Billing Engineer ');
    fill('Location', 'Helsinki');
    fill('Link to the job page', 'https://careers.example.com/jobs/1');
    fill('Job text', 'You keep invoices correct.');
    await submit();

    const request = http.expectOne('/api/jobs');
    expect(request.request.body).toEqual({
      title: 'Billing Engineer',
      url: 'https://careers.example.com/jobs/1',
      text: 'You keep invoices correct.',
      location: 'Helsinki',
    });
    request.flush({ id: '00000000-0000-4000-8000-000000000001' } as JobDetail);
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/jobs', '00000000-0000-4000-8000-000000000001']);
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
  });
});
