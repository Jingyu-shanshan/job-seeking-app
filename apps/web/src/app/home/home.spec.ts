import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Fact, Job, Profile } from '@jsa/shared';
import { Home } from './home';

describe('Home', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;
  const profile: Profile = { name: 'Sample Person', email: '', phone: '', location: '', links: [] };
  const fact = (status: Fact['current']['status'], permitted = false) => ({
    current: { status },
    sendableToModel: permitted,
    usableInMaterials: permitted,
  });
  const job = (application: Job['application'] = null, verdict: Job['verdict'] = 'eligible') => ({
    id: 'job-1',
    title: 'Sample role',
    application,
    verdict,
  });
  const page = () => fixture.nativeElement as HTMLElement;
  const next = () => page().querySelector('.next')?.textContent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Home);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  async function load(
    facts: unknown[] = [],
    name = '',
    jobs: unknown[] = [],
    snapshot: unknown = null,
  ) {
    http.expectOne('/api/facts').flush({ facts });
    http.expectOne('/api/profile').flush({ ...profile, name });
    http.expectOne('/api/jobs').flush({ jobs });
    const stable = fixture.whenStable();
    if (jobs.some((j) => !(j as Job).application && (j as Job).verdict !== 'ineligible')) {
      await vi.waitFor(() => http.expectOne('/api/jobs/job-1').flush({ ...job(), snapshot }));
    }
    await stable;
  }

  it('loads real setup data and gives a useful empty state without requiring Sources', async () => {
    expect(page().textContent).toContain('Loading your next steps');
    expect(page().querySelector('.checklist')).toBeNull();
    await load();
    expect(next()).toContain('Start with your experience');
    expect(page().textContent).toContain('0 confirmed · 0 to confirm');
    expect(page().querySelector('.next a')?.getAttribute('href')).toBe('/facts');
    expect(page().querySelector('a[href="/jobs/paste"]')).not.toBeNull();
    expect(page().textContent).toContain('Sources are optional');
    http.expectNone((r) => r.method !== 'GET');
  });

  it('counts current facts only, excludes withdrawn facts, and asks for confirmation first', async () => {
    await load([
      fact('proposed'),
      fact('retired'),
      { ...fact('confirmed'), earlier: [fact('retired')] },
    ]);
    expect(next()).toContain('Review your experience');
    expect(page().textContent).toContain('1 confirmed · 1 to confirm');
  });

  it('does not count withdrawn facts as setup', async () => {
    await load([fact('retired')]);
    expect(next()).toContain('Start with your experience');
  });

  it('asks for the document name, then a job, based on saved data', async () => {
    await load([fact('confirmed')], '   ');
    expect(next()).toContain('Add your document name');
    fixture.destroy();
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await load([fact('confirmed')], profile.name);
    expect(next()).toContain('Choose a job');
    expect(page().textContent).toContain('Your document name is saved');
  });

  it('requires both existing fact permissions before suggesting generation', async () => {
    await load([{ ...fact('confirmed'), sendableToModel: true }], profile.name, [job()]);
    expect(next()).toContain('Choose your fact permissions');
    http.expectNone((r) => r.method !== 'GET');
  });

  it('links an open job to prepare materials when there is no current draft', async () => {
    await load([fact('confirmed', true)], profile.name, [job()]);
    expect(next()).toContain('Prepare your materials');
    expect(page().querySelector('.next a')?.getAttribute('href')).toBe('/jobs/job-1');
    expect(page().textContent).toContain('no drafts for its current job text');
  });

  it.each([{ outdated: [] }, { outdated: ['Facts changed'] }])(
    'links a real draft for review and explains outdated state: %j',
    async ({ outdated }) => {
      await load([fact('confirmed', true)], profile.name, [job()], {
        drafts: [{ id: 'draft-1', outdated }],
      });
      expect(next()).toContain('Review your materials');
      expect(page().querySelector('.next a')?.getAttribute('href')).toBe('/drafts/draft-1');
      expect(next()).toContain(
        outdated.length ? 'out of date' : 'does not mean you have reviewed or sent',
      );
      expect(page().textContent).toContain('1 draft(s)');
    },
  );

  it('prioritises unknown results and does not suggest resubmitting', async () => {
    await load([], '', [job('to_verify')]);
    expect(next()).toContain('Check an application result');
    expect(page().querySelector('.next a')?.getAttribute('href')).toBe('/jobs/job-1');
    http.expectNone('/api/jobs/job-1');
  });

  it('does not suggest preparing submitted or ruled-out jobs', async () => {
    await load([fact('confirmed', true)], profile.name, [
      job('submitted'),
      job(null, 'ineligible'),
    ]);
    expect(next()).toContain('Choose a job');
    expect(page().textContent).toContain('Review is required for every application');
    http.expectNone('/api/jobs/job-1');
  });

  it('shows a retry instead of inventing setup after a failed read', async () => {
    http.expectOne('/api/facts').error(new ProgressEvent('error'));
    http.expectOne('/api/profile').flush(profile);
    http.expectOne('/api/jobs').flush({ jobs: [] });
    await fixture.whenStable();
    expect(page().querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
    expect(page().querySelector('.checklist')).toBeNull();
    page().querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne('/api/facts').flush({ facts: [] });
    await fixture.whenStable();
    expect(next()).toContain('Start with your experience');
  });

  it('handles a failed material read and reloads the selected job on retry', async () => {
    http.expectOne('/api/facts').flush({ facts: [fact('confirmed', true)] });
    http.expectOne('/api/profile').flush(profile);
    http.expectOne('/api/jobs').flush({ jobs: [job()] });
    const loading = fixture.whenStable();
    await vi.waitFor(() =>
      http.expectOne('/api/jobs/job-1').flush({}, { status: 503, statusText: 'Unavailable' }),
    );
    await loading;
    await fixture.whenStable();
    expect(page().querySelector('[role=alert]')).not.toBeNull();
    page().querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne('/api/jobs/job-1').flush({ ...job(), snapshot: null });
    await fixture.whenStable();
    expect(next()).toContain('Prepare your materials');
  });
});
