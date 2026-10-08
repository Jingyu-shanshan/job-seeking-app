import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import type { CreatedRunnerToken, RunnerToken } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { RunnerApi } from './runner-api';

/** The local runner (T17): what it does, how to start it, and the tokens it signs in with. */
@Component({
  selector: 'app-runner',
  imports: [DatePipe, FormField, FormRoot],
  template: `
    <h1>Runner</h1>
    <p>
      The runner is a program on your computer that fills in a job’s application form in a Chrome
      window you can see. You start each fill on the job’s page; the runner takes one at a time,
      puts in the answers the app shows there, and stops before Submit. Nothing is sent to the
      company until you look at the filled form on the job’s page and approve submitting it; then
      the runner presses Submit once, if the form has not changed, and shows you what the page said.
      It never solves a CAPTCHA, signs in for you or keeps a password: when the page asks for one,
      it pauses and you deal with it in the window. Each fill gets a new Chrome profile, which keeps
      nothing afterwards. For now it fills only Greenhouse’s forms.
    </p>
    <h2>Starting it</h2>
    <ol>
      <li>Issue a token below and copy it.</li>
      <li>
        In the app’s folder on your computer, put it in the <code>.env</code> file as
        <code>JSA_RUNNER_TOKEN=…</code>. If the app does not run on this computer, add its address
        as <code>JSA_APP_URL=https://…</code>.
      </li>
      <li>
        Run <code>npm run runner</code> in a terminal there, and leave it running. Ctrl+C stops it.
      </li>
    </ol>

    <h2>Tokens</h2>
    <form [formRoot]="tokenForm">
      <label>
        A name for it, such as the computer it is on
        <input type="text" [formField]="tokenForm.name" />
      </label>
      @for (error of tokenForm().errors(); track $index) {
        <p class="error" role="alert">{{ error.message }}</p>
      }
      <button type="submit" [disabled]="tokenForm().submitting() || tokenForm().invalid()">
        Issue a token
      </button>
    </form>
    @if (issued(); as created) {
      <div class="issued" role="status">
        <p>
          The token for “{{ created.runnerToken.name }}”. Copy it now: the app keeps only a
          fingerprint of it and cannot show it again.
        </p>
        <code class="token">{{ created.token }}</code>
      </div>
    }
    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }
    @if (tokens.hasValue()) {
      @if (tokens.value().length) {
        <ul class="tokens">
          @for (t of tokens.value(); track t.id) {
            <li>
              <strong>{{ t.name }}</strong
              >, issued {{ t.createdAt | date: 'd MMM y, HH:mm' }}.
              @if (t.revokedAt) {
                Revoked {{ t.revokedAt | date: 'd MMM y, HH:mm' }}.
              } @else {
                {{
                  t.lastUsedAt
                    ? 'Last used ' + (t.lastUsedAt | date: 'd MMM y, HH:mm:ss') + '.'
                    : 'Never used.'
                }}
                <button
                  type="button"
                  [disabled]="busy()"
                  [attr.aria-label]="'Revoke ' + t.name"
                  (click)="revoke(t)"
                >
                  Revoke
                </button>
              }
            </li>
          }
        </ul>
        <p class="hint">
          A revoked token is refused from then on, and the fills its runner had open are closed.
        </p>
      } @else {
        <p>No tokens yet.</p>
      }
    } @else if (tokens.isLoading()) {
      <p role="status">Loading the tokens…</p>
    } @else {
      <p class="error" role="alert">The tokens could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    label {
      display: block;
      margin-bottom: 0.5rem;
    }
    input {
      display: block;
      width: 100%;
      max-width: 30rem;
      box-sizing: border-box;
    }
    .issued {
      border-left: 3px solid color-mix(in srgb, currentColor 40%, transparent);
      padding-left: 0.5rem;
      margin: 1rem 0;
    }
    .token {
      display: block;
      overflow-wrap: anywhere;
      user-select: all;
    }
    .tokens > li {
      margin-bottom: 0.5rem;
    }
    .tokens button {
      margin-left: 0.5rem;
    }
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class RunnerPage {
  private readonly api = inject(RunnerApi);

  protected readonly tokens = httpResource<RunnerToken[]>(() => '/api/runner-tokens');
  protected readonly loadError = computed(() => errorMessage(this.tokens.error()));

  protected readonly issued = signal<CreatedRunnerToken | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  private readonly model = signal({ name: 'This computer' });

  protected readonly tokenForm = form(
    this.model,
    (s) => {
      required(s.name, { message: 'Give the token a name.' });
      maxLength(s.name, 100, { message: 'A name has at most 100 characters.' });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          try {
            this.issued.set(await this.api.issueToken(f.name().value().trim()));
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          this.tokens.reload();
          return undefined;
        },
      },
    },
  );

  protected async revoke(token: RunnerToken) {
    this.issued.set(null);
    this.busy.set(true);
    this.failure.set('');
    try {
      await this.api.revokeToken(token.id);
      this.tokens.reload();
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
