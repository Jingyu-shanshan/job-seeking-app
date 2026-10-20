import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { Session, type User } from './auth/session';

describe('App', () => {
  // A stand-in for the server's answer; the Session's own HTTP calls are tested in session.spec.ts.
  let user: ReturnType<typeof signal<User | null>>;
  let signOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    user = signal<User | null>(null);
    signOut = vi.fn(async () => user.set(null));
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Session,
          useValue: { user, load: async () => user(), signOut },
        },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  const heading = (harness: RouterTestingHarness) =>
    (harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent;

  it('renders the product name as a link to the start page', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('header a');
    expect(link?.textContent).toContain('Job Search Workbench');
    expect(link?.getAttribute('href')).toBe('/');
  });

  it('routes an unknown path to the not-found page', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page');

    expect(heading(harness)).toBe('Page not found');
  });

  it('sends a signed-out user to the sign-in page, remembering where they were going', async () => {
    const harness = await RouterTestingHarness.create('/');

    expect(heading(harness)).toBe('Sign in');
    expect(TestBed.inject(Router).url).toBe('/login?next=%2F');
  });

  it.each([
    '/',
    '/runs',
    '/jobs',
    '/jobs/paste',
    '/jobs/alerts',
    '/jobs/sample',
    '/applications',
    '/applications/sample',
    '/applications/sample/interview',
    '/drafts/sample',
    '/drafts/sample/document',
    '/profile',
    '/answers',
    '/facts',
    '/criteria',
    '/sources',
    '/export',
    '/runner',
  ])('protects the deep link %s and preserves its query and fragment for sign-in', async (path) => {
    const next = `${path}?run=sample#review`;
    const harness = await RouterTestingHarness.create(next);

    expect(heading(harness)).toBe('Sign in');
    const router = TestBed.inject(Router);
    expect(router.parseUrl(router.url).queryParams['next']).toBe(next);
    TestBed.inject(HttpTestingController).expectNone((request) => request.url.startsWith('/api/'));
  });

  it('shows the start page to the signed-in user', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/');
    TestBed.inject(HttpTestingController).expectOne('/api/facts').flush({ facts: [] });
    TestBed.inject(HttpTestingController).expectOne('/api/profile').flush({ name: '' });
    TestBed.inject(HttpTestingController).expectOne('/api/jobs').flush({ jobs: [] });

    expect(heading(harness)).toBe('Your next step');
  });

  it('shows the sources page to the signed-in user', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/sources');

    expect(heading(harness)).toBe('Sources');
  });

  it('shows the jobs page to the signed-in user', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/jobs');
    TestBed.inject(HttpTestingController).expectOne('/api/jobs');

    expect(heading(harness)).toBe('Jobs');
  });

  it('groups the existing routes under Main and Your setup only when signed in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const links = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map((a) =>
        a.getAttribute('href'),
      );
    expect(links()).toEqual([]);

    user.set({ id: 'account-1', email: 'owner@example.com' });
    fixture.detectChanges();
    expect(links()).toEqual([
      '/',
      '/jobs',
      '/runs',
      '/applications',
      '/facts',
      '/profile',
      '/answers',
      '/criteria',
      '/sources',
      '/runner',
      '/export',
    ]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('nav').length).toBe(2);
    expect(root.querySelector('nav[aria-label="Your setup"]')).not.toBeNull();
    expect(root.querySelector('a.skip')?.getAttribute('href')).toBe('#main-content');
    expect(root.querySelector('main')?.tabIndex).toBe(-1);
  });

  it('keeps the current section and title on child routes and closes Menu after navigation', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    const root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const menu = root.querySelector('details')!;
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    await TestBed.inject(Router).navigateByUrl('/jobs/paste?run=sample');
    await fixture.whenStable();

    expect(menu.open).toBe(false);
    expect(root.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/jobs');
    expect(root.querySelector('summary')?.textContent).toContain('Paste a job');
    expect(document.activeElement).toBe(root.querySelector('main'));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('a.skip')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/jobs/paste?run=sample');

    await TestBed.inject(Router).navigateByUrl('/drafts/sample/document');
    await fixture.whenStable();
    expect(root.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/jobs');
    expect(root.querySelector('summary')?.textContent).toContain('Document');

    await TestBed.inject(Router).navigateByUrl('/unknown');
    await fixture.whenStable();
    expect(root.querySelector('nav [aria-current="page"]')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('hides business navigation on the login route even with a cached user', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/login?next=%2Ffacts');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('nav')).toBeNull();
    expect(root.querySelector('.account')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Sign in');
    expect(root.querySelector('app-quick-guide')).toBeNull();
  });

  it('keeps a deep link while guiding, closes and reopens from help, and clears guide memory on sign-out', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/jobs/paste?run=sample#description');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const guide = () => root.querySelector('app-quick-guide')!;
    const button = (label: string) =>
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
    const target = '/jobs/paste?run=sample#description';
    expect(guide().textContent).toContain('Step 1 of 3');
    expect(root.querySelector('nav a.guide-target')?.getAttribute('href')).toBe('/facts');
    expect(root.querySelector('nav a.guide-target')?.getAttribute('aria-describedby')).toBe(
      'guide-title',
    );
    button('Continue').click();
    await fixture.whenStable();
    expect(root.querySelector('nav a.guide-target')?.getAttribute('href')).toBe('/jobs');
    expect(router.url).toBe(target);
    button('Skip guide').click();
    await fixture.whenStable();
    expect(guide().querySelector('section')).toBeNull();
    expect(root.querySelector('nav a.guide-target')).toBeNull();
    expect(document.activeElement).toBe(button('Quick guide'));
    button('Quick guide').click();
    await fixture.whenStable();
    expect(guide().textContent).toContain('Step 1 of 3');
    expect(document.activeElement?.id).toBe('guide-title');
    expect(router.url).toBe(target);
    guide()
      .querySelector('button')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(button('Quick guide'));
    button('Quick guide').click();
    await fixture.whenStable();
    button('Sign out').click();
    await fixture.whenStable();
    expect(root.querySelector('app-quick-guide')).toBeNull();
    expect(router.url).toBe('/login');
    user.set({ id: 'account-2', email: 'owner@example.com' });
    await router.navigateByUrl(target);
    await fixture.whenStable();
    expect(guide().textContent).toContain('Step 1 of 3');
    expect(localStorage.getItem('jsa:quick-guide:v1:account-2')).toBeNull();
    TestBed.inject(HttpTestingController).expectNone((r) => r.method !== 'GET');
  });

  it('closes the narrow Menu with Escape and returns focus to its summary', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector('details')!;
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    root.querySelector<HTMLAnchorElement>('nav a')!.focus();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  });

  it('keeps wide navigation open and returns keyboard focus when shrinking to Menu', async () => {
    const breakpoint = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal('matchMedia', () => breakpoint);
    try {
      user.set({ id: 'account-1', email: 'owner@example.com' });
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const menu = root.querySelector('details')!;
      expect(menu.open).toBe(true);
      root.querySelector<HTMLAnchorElement>('nav a')!.focus();
      breakpoint.matches = false;
      breakpoint.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(menu.open).toBe(false);
      expect(document.activeElement).toBe(menu.querySelector('summary'));
      breakpoint.matches = true;
      breakpoint.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(menu.open).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the session visible when sign-out fails and permits retry', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    signOut.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.account button:last-of-type')!.click();
    await fixture.whenStable();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out');
    expect(root.textContent).toContain('owner@example.com');
    expect(root.querySelector<HTMLButtonElement>('.account button:last-of-type')?.disabled).toBe(
      false,
    );
    root.querySelector<HTMLButtonElement>('.account button:last-of-type')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(root.querySelector('nav')).toBeNull();
  });

  it('prevents repeated sign-out while the request is pending', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    let finish!: () => void;
    signOut.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('.account button:last-of-type')!;
    button.click();
    button.click();
    fixture.detectChanges();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Signing out…');
    finish();
    await fixture.whenStable();
  });

  it('shows who is signed in and signs out', async () => {
    user.set({ id: 'account-1', email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector('header')!;
    expect(header.textContent).toContain('owner@example.com');

    Array.from(header.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Sign out')!
      .click();
    await fixture.whenStable();

    expect(signOut).toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(header.querySelector('button')).toBeNull();
  });
});
