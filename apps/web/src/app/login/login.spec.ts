import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Session } from '../auth/session';
import { Login } from './login';

@Component({ template: '<h1>Target</h1>' })
class Target {}

describe('Login', () => {
  let signIn: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    signIn = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Login },
          { path: '**', component: Target },
        ]),
        { provide: Session, useValue: { signIn } },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login?next=%2Fjobs%2F1%3Ftab%3Dmatch');
  });

  const page = () => harness.routeNativeElement as HTMLElement;
  const input = (id: string) => page().querySelector<HTMLInputElement>(`#${id}`)!;
  const alertText = () => page().querySelector('[role=alert]')?.textContent?.trim();

  async function submit(email: string, password: string) {
    for (const [id, value] of [
      ['email', email],
      ['password', password],
    ] as const) {
      input(id).value = value;
      input(id).dispatchEvent(new Event('input'));
    }
    page()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
  }

  it('labels both fields for password managers and screen readers', () => {
    expect(input('email').autocomplete).toBe('username');
    expect(input('password').autocomplete).toBe('current-password');
    expect(page().querySelector('label[for=email]')).not.toBeNull();
    expect(page().querySelector('label[for=password]')).not.toBeNull();
  });

  it('does not send an incomplete form', async () => {
    await submit('not an email', '');

    expect(signIn).not.toHaveBeenCalled();
    expect(page().querySelector('#email-error')?.textContent).toContain('valid email');
    expect(page().querySelector('#password-error')?.textContent).toContain('Enter your password');
    expect(input('email').getAttribute('aria-describedby')).toBe('email-error');
  });

  it('signs in and returns to the page that asked for it', async () => {
    signIn.mockResolvedValue(undefined);

    await submit('owner@example.com', 'a password');

    expect(signIn).toHaveBeenCalledWith('owner@example.com', 'a password');
    expect(TestBed.inject(Router).url).toBe('/jobs/1?tab=match');
  });

  it('says so when the password is wrong, and stays on the page', async () => {
    signIn.mockRejectedValue(new HttpErrorResponse({ status: 401 }));

    await submit('owner@example.com', 'wrong');

    expect(alertText()).toBe('The email address or password is wrong.');
    expect(TestBed.inject(Router).url).toMatch(/^\/login/);
  });

  it('ignores a return address outside the app', async () => {
    await harness.navigateByUrl('/login?next=https%3A%2F%2Fevil.example');
    signIn.mockResolvedValue(undefined);

    await submit('owner@example.com', 'a password');

    expect(TestBed.inject(Router).url).toBe('/');
  });
});
