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

  it('shows the start page to the signed-in user', async () => {
    user.set({ email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/');
    TestBed.inject(HttpTestingController).expectOne('/health').flush({ status: 'ok' });

    expect(heading(harness)).toBe('Job Search Workbench');
  });

  it('shows the sources page to the signed-in user', async () => {
    user.set({ email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/sources');

    expect(heading(harness)).toBe('Sources and search scope');
  });

  it('shows the jobs page to the signed-in user', async () => {
    user.set({ email: 'owner@example.com' });
    const harness = await RouterTestingHarness.create('/jobs');
    TestBed.inject(HttpTestingController).expectOne('/api/jobs');

    expect(heading(harness)).toBe('Jobs');
  });

  it('links the jobs, facts and sources pages from the header once signed in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const links = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map((a) =>
        a.getAttribute('href'),
      );
    expect(links()).toEqual([]);

    user.set({ email: 'owner@example.com' });
    fixture.detectChanges();
    expect(links()).toEqual(['/jobs', '/facts', '/sources']);
  });

  it('shows who is signed in and signs out', async () => {
    user.set({ email: 'owner@example.com' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector('header')!;
    expect(header.textContent).toContain('owner@example.com');

    header.querySelector('button')!.click();
    await fixture.whenStable();

    expect(signOut).toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(header.querySelector('button')).toBeNull();
  });
});
