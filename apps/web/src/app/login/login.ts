import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { Session } from '../auth/session';

@Component({
  imports: [FormField, FormRoot],
  selector: 'app-login',
  styleUrl: './login.css',
  template: `
    <h1>Sign in</h1>
    <form [formRoot]="loginForm">
      <label for="email">Email</label>
      <input
        id="email"
        type="email"
        autocomplete="username"
        [formField]="loginForm.email"
        [attr.aria-describedby]="showErrors(loginForm.email) ? 'email-error' : null"
      />
      @if (showErrors(loginForm.email)) {
        <p class="error" id="email-error">{{ loginForm.email().errors()[0]?.message }}</p>
      }

      <label for="password">Password</label>
      <input
        id="password"
        type="password"
        autocomplete="current-password"
        [formField]="loginForm.password"
        [attr.aria-describedby]="showErrors(loginForm.password) ? 'password-error' : null"
      />
      @if (showErrors(loginForm.password)) {
        <p class="error" id="password-error">{{ loginForm.password().errors()[0]?.message }}</p>
      }

      <button type="submit" [disabled]="loginForm().submitting()">Sign in</button>
      <p class="error" role="alert">{{ loginForm().errors()[0]?.message }}</p>
    </form>
  `,
})
export class Login {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly credentials = signal({ email: '', password: '' });
  protected readonly loginForm = form(
    this.credentials,
    (path) => {
      required(path.email, { message: 'Enter your email address.' });
      email(path.email, { message: 'Enter a valid email address.' });
      required(path.password, { message: 'Enter your password.' });
    },
    {
      submission: {
        action: async (fields) => {
          const { email, password } = fields().value();
          try {
            await this.session.signIn(email, password);
          } catch (error) {
            return { kind: 'sign-in', message: signInFailure(error) };
          }
          // Back to the page that sent the user here. Only a path inside the app: the router
          // cannot leave the site anyway.
          const next = this.route.snapshot.queryParamMap.get('next');
          await this.router.navigateByUrl(next?.startsWith('/') ? next : '/');
          return undefined;
        },
      },
    },
  );

  protected showErrors(field: typeof this.loginForm.email) {
    return field().touched() && field().invalid();
  }
}

function signInFailure(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  if (status === 401) return 'The email address or password is wrong.';
  if (status === 403) return 'Signing in is not allowed from this address of the app.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status === 0) return 'The server cannot be reached.';
  return 'Signing in failed. Try again.';
}
