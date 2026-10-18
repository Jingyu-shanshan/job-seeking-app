import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Criteria, Run, RunConfig } from '@jsa/shared';
import { Runs } from './runs';

const config: RunConfig = {
  name: 'Sample search',
  discoveryLimit: 20,
  materialLimit: 2,
  submissionLimit: 1,
  requestLimit: 20,
  timeLimitSeconds: 600,
  costLimitUsd: 0.1,
  intervalHours: 0,
};
const criteria: Criteria = {
  location: { strength: 'hard', ifUnknown: 'to_confirm', area: 'helsinki', includeRemote: false },
  title: { strength: 'hard', words: ['backend'] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { strength: 'hard', ifUnknown: 'rule_out', languages: ['English'] },
  employmentType: { strength: 'preference', ifUnknown: 'to_confirm', types: ['full_time'] },
  mustHaves: { strength: 'hard', ifUnknown: 'to_confirm' },
};
const preset = { id: '00000000-0000-4000-8000-000000000001', config };
const run: Run = {
  id: preset.id,
  presetId: preset.id,
  config,
  criteria,
  sources: [{ id: preset.id, catalogId: 'sample_board', param: 'sample', enabled: false }],
  status: 'paused',
  message: 'Estimated cost limit reached.',
  createdAt: '2026-10-18T08:00:00Z',
  requests: 3,
  materials: 1,
  submissions: 1,
  elapsedSeconds: 42,
  costUsd: 0.08,
  jobs: [{ id: preset.id, title: 'Sample Backend Engineer', stage: 'matched', message: '' }],
};
async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('Runs', () => {
  let fixture: ComponentFixture<Runs>, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Runs],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Runs);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  it('starts with zero model spend, draft and submission limits, and no schedule', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await fixture.whenStable();
    const inputs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input'),
    );
    expect(inputs.map((i) => i.value)).toEqual([
      'My job search',
      '20',
      '0',
      '0',
      '20',
      '600',
      '0',
      '0',
    ]);
    expect(fixture.nativeElement.textContent).toContain(
      'Every submission still needs your individual approval',
    );
  });
  it('saving a preset does not start a run, and exposes errors', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const save = http.expectOne('/api/run-presets');
    expect(save.request.body.costLimitUsd).toBe(0);
    save.flush({ message: 'Could not save the preset.' }, { status: 500, statusText: 'Error' });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not save the preset.');
    http.expectNone('/api/runs');
  });
  it('keeps the new preset after a failed save, then updates the saved preset instead of creating another', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await settle();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const name = page.querySelector('input')!;
    name.value = 'Sample new preset';
    name.dispatchEvent(new Event('input'));
    await settle();
    await fixture.whenStable();
    page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const request = http.expectOne('/api/run-presets');
    TestBed.tick();
    expect(page.textContent).toContain('Saving preset…');
    expect(name.closest('fieldset')?.disabled).toBe(true);
    page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectNone('/api/run-presets');
    request.flush({ message: 'Sample write failed.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    await fixture.whenStable();
    expect(name.value).toBe('Sample new preset');
    page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const retry = http.expectOne('/api/run-presets');
    const saved = { id: preset.id, config: retry.request.body as RunConfig };
    retry.flush(saved);
    await settle();
    http.expectOne('/api/runs').flush({ presets: [saved], runs: [] });
    await settle();
    await fixture.whenStable();
    expect(page.textContent).toContain('Preset saved. No unsaved changes.');
    expect(page.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    http.expectNone((req) => req.method === 'POST' && req.url === '/api/runs');
    name.value = 'Sample renamed preset';
    name.dispatchEvent(new Event('input'));
    await settle();
    await fixture.whenStable();
    page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const update = http.expectOne('/api/run-presets/' + saved.id);
    expect(update.request.method).toBe('PUT');
    update.flush({ ...saved, config: update.request.body });
    await settle();
    http.expectOne('/api/runs').flush({ presets: [saved], runs: [] });
    await settle();
    await fixture.whenStable();
  });

  it('shows captured criteria, disabled sources, cost reservations and run-bound job links', async () => {
    http.expectOne('/api/runs').flush({ presets: [preset], runs: [run] });
    await settle();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const article = page.querySelector('article')!;
    expect(article.textContent).toContain('Stopped');
    expect(article.textContent).toContain('Estimated cost limit reached.');
    expect(article.textContent).toContain('unknown reservations');
    expect(article.textContent).toContain('Stopping a run withdraws unused approvals');
    const snapshot = article.querySelector('.criteria-snapshot')!;
    expect(snapshot.textContent).toContain('backend');
    expect(snapshot.textContent).toContain('English');
    expect(snapshot.textContent).toContain('Rule out');
    expect(snapshot.textContent).toContain('Full-time');
    expect(article.textContent).toContain('sample_board sample (disabled)');
    expect(article.querySelector('a')!.getAttribute('href')).toBe(
      '/jobs/' + run.jobs[0]!.id + '?run=' + run.id,
    );
    http.expectNone((req) => req.method !== 'GET');
  });

  it('serialises resume and stop, keeping counters and captured configuration on refresh', async () => {
    http.expectOne('/api/runs').flush({ presets: [preset], runs: [run] });
    await settle();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...page.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
    button('Resume').click();
    const resume = http.expectOne('/api/runs/' + run.id + '/resume');
    expect(resume.request.body).toEqual({});
    TestBed.tick();
    expect(page.textContent).toContain('Resuming run…');
    expect(button('Start run').disabled).toBe(true);
    button('Resume').click();
    http.expectNone('/api/runs/' + run.id + '/resume');
    resume.flush({ ...run, status: 'queued' });
    await settle();
    http.expectOne('/api/runs').flush({ presets: [preset], runs: [{ ...run, status: 'running' }] });
    await settle();
    await fixture.whenStable();
    expect(button('Start run').disabled).toBe(true);
    button('Stop').click();
    http.expectOne('/api/runs/' + run.id + '/stop').flush(run);
    await settle();
    http.expectOne('/api/runs').flush({ presets: [preset], runs: [run] });
    await settle();
    await fixture.whenStable();
    expect(page.querySelector('article')!.textContent).toContain('3 / 20 requests');
    expect(page.querySelector('article')!.textContent).toContain('USD 0.08 / 0.10');
    expect(page.textContent).toContain('cost reservations are retained');
  });

  it('refreshes run status after a failed start before allowing another start', async () => {
    http.expectOne('/api/runs').flush({ presets: [preset], runs: [] });
    await settle();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const start = [...page.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Start run',
    )!;
    start.click();
    http
      .expectOne({ method: 'POST', url: '/api/runs' })
      .flush({ message: 'Sample response lost.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(start.disabled).toBe(true);
    http
      .expectOne({ method: 'GET', url: '/api/runs' })
      .flush({ presets: [preset], runs: [{ ...run, status: 'queued' }] });
    await settle();
    await fixture.whenStable();
    expect(start.disabled).toBe(true);
    expect(page.textContent).toContain('Check recent runs before trying again.');
  });

  it('explains enabling a schedule without starting it on input changes', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await settle();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const interval = [...page.querySelectorAll('input')].at(-1)!;
    interval.value = '2';
    interval.dispatchEvent(new Event('input'));
    await settle();
    await fixture.whenStable();
    expect(page.textContent?.replace(/\s+/g, ' ')).toContain(
      'Saving this preset enables a scheduled run every 2 hours.',
    );
    expect(page.textContent).toContain('Missed times are not replayed.');
    http.expectNone((req) => req.method !== 'GET');
    interval.value = '0.5';
    interval.dispatchEvent(new Event('input'));
    page.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
    await fixture.whenStable();
    expect(page.textContent).toContain('Use whole numbers');
    http.expectNone((req) => req.method !== 'GET');
  });
});
