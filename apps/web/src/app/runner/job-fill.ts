import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { FillTaskStatus, JobFillState, PreviewField, PreviewFieldState } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { RunnerApi } from './runner-api';

const statusLabels: Record<FillTaskStatus, string> = {
  waiting: 'Waiting for the runner',
  filling: 'Filling in',
  paused: 'Paused: your turn',
  filled: 'Filled in, stopped before Submit',
  closed: 'Closed',
  failed: 'Failed',
};

const stateLabels: Record<PreviewFieldState, string> = {
  as_filled: 'As the app filled it in',
  changed: 'Not what the app filled in',
  empty: 'Empty: the app’s answer did not go in',
  from_window: 'Not from the app',
  left_empty: 'Empty',
  missing: 'Not on the page',
};

const open: readonly FillTaskStatus[] = ['waiting', 'filling', 'paused', 'filled'];

/** How long a runner may be quiet before the page says so. */
const quietMs = 30_000;
const pollMs = 2000;

/**
 * Filling the job's form with the local runner (T17): start a fill, follow it while the runner
 * works, continue it after acting in the window, close it, and see what the form holds.
 */
@Component({
  selector: 'app-job-fill',
  imports: [DatePipe, RouterLink],
  template: `
    <h3>Fill it in with the runner</h3>
    <p class="hint">
      The <a routerLink="/runner">runner</a> on your computer opens this form in a Chrome window you
      can see, puts in the answers above and stops before Submit, so nothing is sent to the company.
      When the page asks for something only you may do, such as a CAPTCHA or signing in, it pauses
      and you do it in the window.
    </p>
    @if (state.hasValue()) {
      @let s = state.value();
      @if (s.task; as task) {
        @let active = isOpen(task.status);
        @if (active) {
          <p>
            <strong>{{ statusLabels[task.status] }}.</strong>&ngsp;<span>{{ task.message }}</span>
          </p>
        } @else {
          <p>Last fill: {{ statusLabels[task.status] }}. {{ task.message }}</p>
        }
        @if (task.status === 'waiting' && !runnerNear()) {
          <p class="warning">
            No runner has asked the app for work in the last half minute. Start it on your computer
            with <code>npm run runner</code>; the <a routerLink="/runner">Runner</a> page says how.
            It fills one form at a time.
          </p>
        }
        @if ((task.status === 'filling' || task.status === 'paused') && quietSince(); as since) {
          <p class="warning">
            The runner has not been in touch since {{ since | date: 'HH:mm:ss' }}. If it stopped,
            close this fill.
          </p>
        }
        @if (active) {
          <p class="actions">
            @if (task.status === 'paused') {
              <button type="button" [disabled]="busy()" (click)="continueFill(task.id)">
                Continue
              </button>
            }
            @if (task.status === 'filled') {
              <button type="button" [disabled]="busy()" (click)="continueFill(task.id)">
                Look at the form again
              </button>
            }
            <button type="button" [disabled]="busy()" (click)="close(task.id)">
              {{ task.status === 'waiting' ? 'Cancel' : 'Close the window' }}
            </button>
          </p>
        }
      }
      @if (!s.task || !isOpen(s.task.status)) {
        @if (s.cannotStart) {
          <p>{{ s.cannotStart }}</p>
        } @else {
          <button type="button" [disabled]="busy()" (click)="start()">
            Fill in the form with the runner
          </button>
        }
      }
      @if (s.task?.check; as check) {
        <h4>{{ isOpen(s.task!.status) ? 'What the form holds' : 'What the form held' }}</h4>
        <p class="hint">
          As the runner read it from the page at {{ check.checkedAt | date: 'HH:mm:ss' }}.
        </p>
        <ul class="fields">
          @for (f of check.fields; track f.key) {
            <li [class]="f.state" [class.problem]="isProblem(f)">
              <span class="label"
                >{{ f.label }}
                <span class="hint">({{ f.required ? 'required' : 'optional' }})</span></span
              >
              <span class="value">{{ f.value.join('; ') || '—' }}</span>
              <span class="state">{{ stateLabels[f.state] }}</span>
              @if ((f.state === 'changed' || f.state === 'missing') && f.appAnswer.length) {
                <span class="note">The app put in: {{ f.appAnswer.join('; ') }}</span>
              }
            </li>
          }
        </ul>
        <a [href]="check.screenshotUrl" target="_blank" rel="noopener">
          <img class="screenshot" [src]="check.screenshotUrl" alt="The form as the runner saw it" />
        </a>
      }
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
    } @else if (state.isLoading()) {
      <p role="status">Loading…</p>
    } @else {
      <p class="error" role="alert">The fill could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    .hint,
    .note {
      font-size: 0.9rem;
    }
    .warning {
      font-size: 0.9rem;
      border-left: 3px solid color-mix(in srgb, currentColor 40%, transparent);
      padding-left: 0.5rem;
    }
    .actions button {
      margin-right: 0.5rem;
    }
    .fields {
      padding-left: 1.25rem;
    }
    .fields > li {
      margin-bottom: 0.5rem;
    }
    .fields span {
      display: block;
    }
    .label {
      font-weight: 600;
    }
    .label .hint {
      display: inline;
      font-weight: normal;
    }
    .value {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .state {
      font-size: 0.9rem;
    }
    .problem .state {
      color: light-dark(#a3141c, #ff9b9b);
      font-weight: 600;
    }
    .screenshot {
      display: block;
      max-width: 100%;
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class JobFill {
  private readonly api = inject(RunnerApi);

  readonly jobId = input.required<string>();

  protected readonly state = httpResource<JobFillState>(() => `/api/jobs/${this.jobId()}/fill`);
  protected readonly loadError = computed(() => errorMessage(this.state.error()));

  protected readonly statusLabels = statusLabels;
  protected readonly stateLabels = stateLabels;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  private readonly following = computed(() => {
    const status = this.state.value()?.task?.status;
    return status !== undefined && open.includes(status);
  });

  /** Whether a runner asked for work lately. */
  protected readonly runnerNear = computed(() => {
    const seen = this.state.value()?.runnerSeenAt;
    return !!seen && Date.now() - Date.parse(seen) < quietMs;
  });

  /** When the runner working on the fill was last in touch, if that was a while ago. */
  protected readonly quietSince = computed(() => {
    const seen = this.state.value()?.task?.runnerSeenAt;
    return seen && Date.now() - Date.parse(seen) >= quietMs ? seen : null;
  });

  constructor() {
    // While a fill is open the runner moves it on its own, so the page asks again now and then.
    effect((onCleanup) => {
      if (!this.following()) return;
      const timer = setInterval(() => this.state.reload(), pollMs);
      onCleanup(() => clearInterval(timer));
    });
  }

  /** The answers may have changed: whether a fill can start, and with what, is asked again. */
  refresh() {
    this.state.reload();
  }

  protected isOpen(status: FillTaskStatus) {
    return open.includes(status);
  }

  protected isProblem(f: PreviewField) {
    return (
      f.state === 'changed' ||
      f.state === 'empty' ||
      f.state === 'missing' ||
      (f.required && f.state === 'left_empty')
    );
  }

  protected start() {
    return this.run(() => this.api.startFill(this.jobId()));
  }

  protected continueFill(taskId: string) {
    return this.run(() => this.api.continueFill(taskId));
  }

  protected close(taskId: string) {
    return this.run(() => this.api.closeFill(taskId));
  }

  private async run(change: () => Promise<JobFillState>) {
    this.busy.set(true);
    this.failure.set('');
    try {
      this.state.set(await change());
    } catch (error) {
      this.failure.set(errorMessage(error));
      this.state.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
