import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Session } from './session';

describe('Session', () => {
  let session: Session;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(Session);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Lets `firstValueFrom` subscribe before the test looks for the request. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('asks the server once, then remembers the answer', async () => {
    const first = session.load();
    await settle();
    http.expectOne('/api/auth/get-session').flush({ user: { email: 'owner@example.com' } });
    expect(await first).toEqual({ email: 'owner@example.com' });

    expect(await session.load()).toEqual({ email: 'owner@example.com' });
    expect(session.user()).toEqual({ email: 'owner@example.com' });
  });

  it('is signed out when the server has no session', async () => {
    const load = session.load();
    await settle();
    http.expectOne('/api/auth/get-session').flush(null);
    expect(await load).toBeNull();
    expect(session.user()).toBeNull();
  });

  it('counts an unreachable server as signed out and asks again next time', async () => {
    const load = session.load();
    await settle();
    http.expectOne('/api/auth/get-session').error(new ProgressEvent('error'));
    expect(await load).toBeNull();
    expect(session.user()).toBeUndefined();

    const again = session.load();
    await settle();
    http.expectOne('/api/auth/get-session').flush(null);
    expect(await again).toBeNull();
  });

  it('tracks signing in and out', async () => {
    const signIn = session.signIn('owner@example.com', 'a password');
    await settle();
    const request = http.expectOne('/api/auth/sign-in/email');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'owner@example.com', password: 'a password' });
    request.flush({ user: { email: 'owner@example.com' } });
    await signIn;
    expect(session.user()).toEqual({ email: 'owner@example.com' });

    const signOut = session.signOut();
    await settle();
    http.expectOne({ method: 'POST', url: '/api/auth/sign-out' }).flush({ success: true });
    await signOut;
    expect(session.user()).toBeNull();
  });
});
