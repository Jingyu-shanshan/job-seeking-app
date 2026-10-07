import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RunnerToken } from '@jsa/shared';
import { RunnerPage } from './runner';

const laptop: RunnerToken = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Laptop',
  createdAt: '2026-10-07T08:00:00.000Z',
  lastUsedAt: '2026-10-07T09:30:00.000Z',
  revokedAt: null,
};
const old: RunnerToken = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Old laptop',
  createdAt: '2026-10-01T08:00:00.000Z',
  lastUsedAt: null,
  revokedAt: '2026-10-02T08:00:00.000Z',
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('RunnerPage', () => {
  let fixture: ComponentFixture<RunnerPage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find(
      (b) => text(b) === label || b.getAttribute('aria-label') === label,
    );

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [RunnerPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(RunnerPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(tokens: RunnerToken[]) {
    http.expectOne('/api/runner-tokens').flush(tokens);
    await fixture.whenStable();
  }

  it('says what the runner does and how to start it', async () => {
    await load([]);
    expect(text()).toContain('stops before Submit, so nothing is sent to the company');
    expect(text()).toContain('It never solves a CAPTCHA, signs in for you or keeps a password');
    expect(text()).toContain('JSA_RUNNER_TOKEN=…');
    expect(text()).toContain('npm run runner');
    expect(text()).toContain('No tokens yet.');
  });

  it('lists the tokens, with when they were last used or revoked', async () => {
    await load([laptop, old]);
    const items = [...page().querySelectorAll('.tokens > li')].map((li) => text(li));
    expect(items[0]).toMatch(
      /^Laptop, issued 7 Oct 2026, \d\d:00\. Last used 7 Oct 2026, \d\d:30:00\. Revoke$/,
    );
    expect(items[1]).toMatch(
      /^Old laptop, issued 1 Oct 2026, \d\d:00\. Revoked 2 Oct 2026, \d\d:00\.$/,
    );
    expect(button('Revoke Old laptop')).toBeUndefined();
  });

  it('issues a token and shows it once', async () => {
    await load([]);
    const input = page().querySelector('input')!;
    expect(input.value).toBe('This computer');
    input.value = '  Work laptop ';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    button('Issue a token')!.click();
    TestBed.tick();
    const request = http.expectOne('/api/runner-tokens');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Work laptop' });
    const token = `jsa_runner_${'a'.repeat(43)}`;
    request.flush({ token, runnerToken: { ...laptop, name: 'Work laptop', lastUsedAt: null } });
    await settle();
    http.expectOne('/api/runner-tokens').flush([{ ...laptop, name: 'Work laptop' }]);
    await fixture.whenStable();
    expect(text(page().querySelector('.issued'))).toContain(
      'The token for “Work laptop”. Copy it now: the app keeps only a fingerprint of it and cannot show it again.',
    );
    expect(text(page().querySelector('.token'))).toBe(token);
  });

  it('needs a name, and shows why the app refused', async () => {
    await load([]);
    const input = page().querySelector('input')!;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(button('Issue a token')!.disabled).toBe(true);
    input.value = 'Laptop';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    button('Issue a token')!.click();
    TestBed.tick();
    http
      .expectOne('/api/runner-tokens')
      .flush({ message: 'Something is wrong.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe('Something is wrong.');
  });

  it('revokes a token', async () => {
    await load([laptop]);
    button('Revoke Laptop')!.click();
    TestBed.tick();
    const request = http.expectOne(`/api/runner-tokens/${laptop.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ ...laptop, revokedAt: '2026-10-07T10:00:00.000Z' });
    await settle();
    http
      .expectOne('/api/runner-tokens')
      .flush([{ ...laptop, revokedAt: '2026-10-07T10:00:00.000Z' }]);
    await fixture.whenStable();
    expect(text(page().querySelector('.tokens'))).toContain('Revoked 7 Oct 2026');
    expect(text()).toContain('the fills its runner had open are closed');
  });
});
