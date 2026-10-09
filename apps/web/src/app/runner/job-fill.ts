import { httpResource } from '@angular/common/http';
import { DatePipe, SlicePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  ApplicationStatus,
  FillTaskStatus,
  JobFillState,
  PreviewField,
  PreviewFieldState,
} from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { RunnerApi } from './runner-api';

const statusLabels: Record<FillTaskStatus, string> = {
  waiting: 'Waiting for the runner',
  filling: 'Filling in',
  paused: 'Paused: your turn',
  filled: 'Filled in, stopped before Submit',
  approved: 'Approved for submitting',
  submitting: 'Submit pressed',
  submitted: 'Submitted',
  to_verify: 'Submitted, result unknown',
  closed: 'Closed',
  failed: 'Failed',
};

const applicationLabels: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  to_verify: 'Result unknown',
  not_submitted: 'Did not go through',
};

const stateLabels: Record<PreviewFieldState, string> = {
  as_filled: 'As the app filled it in',
  changed: 'Not what the app filled in',
  empty: 'Empty: the app’s answer did not go in',
  from_window: 'Not from the app',
  left_empty: 'Empty',
  missing: 'Not on the page',
};

const open: readonly FillTaskStatus[] = [
  'waiting',
  'filling',
  'paused',
  'filled',
  'approved',
  'submitting',
];

/** How long a runner may be quiet before the page says so. */
const quietMs = 30_000;
const pollMs = 2000;

/**
 * Filling the job's form with the local runner (T17): start a fill, follow it while the runner
 * works, continue it after acting in the window, close it, and see what the form holds. Then
 * (T18) approve submitting it, follow the submission, and say whether a submission whose result is
 * unknown went through.
 */
@Component({
  selector: 'app-job-fill',
  imports: [DatePipe, RouterLink, SlicePipe],
  template: `
    <h3>Fill it in with the runner</h3>
    <p class="hint">
      The <a routerLink="/runner">runner</a> on your computer opens this form in a Chrome window you
      can see, puts in the answers above and stops before Submit. When the page asks for something
      only you may do, such as a CAPTCHA or signing in, it pauses and you do it in the window.
      Nothing is sent to the company until you approve submitting this one form below.
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
        @if (runnerActs(task.status) && quietSince(); as since) {
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
            @if (task.status === 'approved') {
              <button type="button" [disabled]="busy()" (click)="withdraw(task.id)">
                Withdraw your approval
              </button>
            }
            @if (task.status !== 'submitting') {
              <button type="button" [disabled]="busy()" (click)="close(task.id)">
                {{ task.status === 'waiting' ? 'Cancel' : 'Close the window' }}
              </button>
            }
          </p>
        }
        @if (s.approval; as approval) {
          <section class="approval" aria-labelledby="approval-heading">
            <h4 id="approval-heading">Submit this application</h4>
            <p class="hint">
              Approving lets the runner press Submit once, for this job only, with the form exactly
              as shown below. Just before, it reads the form again; if anything has changed, it does
              not press Submit. The approval binds:
            </p>
            <ul class="binds">
              <li>
                the value of every field below, as read at
                {{ task.check?.checkedAt | date: 'HH:mm:ss' }};
              </li>
              @if (approval.snapshot; as snapshot) {
                <li>
                  the job’s text as read on {{ snapshot.capturedAt | date: 'd MMM y, HH:mm' }};
                </li>
              }
              @for (file of approval.files; track file.label) {
                <li>
                  {{ file.label }}: {{ file.fileName }}
                  <span class="hint"
                    >(SHA-256 <code>{{ file.sha256 | slice: 0 : 12 }}…</code>)</span
                  >;
                </li>
              }
              <li>your answers and documents as the fill started with them.</li>
            </ul>
            <p class="hint">
              {{ approval.submittedLastDay }} of at most {{ approval.dailyCap }} applications went
              in (or may have) in the last 24 hours.
            </p>
            @if (task.status === 'filled') {
              @if (approval.problem) {
                <p class="warning">{{ approval.problem }}</p>
              } @else {
                <button
                  type="button"
                  class="primary"
                  [disabled]="busy()"
                  (click)="approve(task.id, task.check!.id)"
                >
                  Approve and submit
                </button>
              }
            } @else if (approval.problem) {
              <p class="warning">
                This approval no longer holds: {{ approval.problem }} The runner will not press
                Submit; it gives the form back to you.
              </p>
            }
          </section>
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
      @if (s.application; as application) {
        <section class="application" aria-labelledby="application-heading">
          <h4 id="application-heading">Application: {{ applicationLabels[application.status] }}</h4>
          @switch (application.status) {
            @case ('submitted') {
              <p>
                @if (application.method === 'manual') {
                  You recorded that you sent it outside the app on
                  {{ application.submittedAt | date: 'd MMM y, HH:mm' }}.
                } @else {
                  The runner pressed Submit on
                  {{ application.createdAt | date: 'd MMM y, HH:mm' }}
                  @if (application.receipt?.confirmed) {
                    and Greenhouse showed its confirmation page.
                  } @else {
                    and you said it went through.
                  }
                }
              </p>
            }
            @case ('to_verify') {
              <p>
                The runner pressed Submit on {{ application.createdAt | date: 'd MMM y, HH:mm' }},
                but did not see Greenhouse’s confirmation page. Check your email or the company’s
                site. The app never presses Submit again by itself.
              </p>
              @if (s.task?.status !== 'submitting') {
                <p class="actions">
                  <button type="button" [disabled]="busy()" (click)="settle(application.id, true)">
                    It went through
                  </button>
                  <button type="button" [disabled]="busy()" (click)="settle(application.id, false)">
                    It did not go through
                  </button>
                </p>
              }
            }
            @case ('not_submitted') {
              <p>
                The runner pressed Submit on {{ application.createdAt | date: 'd MMM y, HH:mm' }};
                you said it did not go through, so the form may be filled and approved again.
              </p>
            }
          }
          <p>
            <a [routerLink]="['/applications', application.id]">What the application kept</a>
          </p>
          @if (application.receipt; as receipt) {
            <p class="hint">
              What the runner saw at {{ receipt.checkedAt | date: 'HH:mm:ss' }}:
              {{ receipt.note || receipt.pageText }}
            </p>
            @if (receipt.screenshotUrl) {
              <a [href]="receipt.screenshotUrl" target="_blank" rel="noopener">
                <img class="screenshot" [src]="receipt.screenshotUrl" alt="The page after Submit" />
              </a>
            }
          }
        </section>
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
    .approval,
    .application {
      margin-top: 1rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    }
    .binds {
      padding-left: 1.25rem;
      overflow-wrap: anywhere;
    }
    .primary {
      font-weight: 600;
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
  /** The job's latest fill or application changed status, or a new one began. */
  readonly applicationChanged = output<void>();

  protected readonly state = httpResource<JobFillState>(() => `/api/jobs/${this.jobId()}/fill`);
  protected readonly loadError = computed(() => errorMessage(this.state.error()));

  protected readonly statusLabels = statusLabels;
  protected readonly applicationLabels = applicationLabels;
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

  /** What the job's applications depend on here: the latest fill and application, by status. */
  private readonly applicationKey = computed(() => {
    const s = this.state.value();
    if (!s) return undefined;
    return [s.task?.id, s.task?.status, s.application?.id, s.application?.status].join('|');
  });

  constructor() {
    let lastKey: string | undefined;
    effect(() => {
      const key = this.applicationKey();
      if (key === undefined) return;
      if (lastKey !== undefined && key !== lastKey) this.applicationChanged.emit();
      lastKey = key;
    });
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

  /** Whether the runner should be in touch about the fill now. */
  protected runnerActs(status: FillTaskStatus) {
    return ['filling', 'paused', 'approved', 'submitting'].includes(status);
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

  protected approve(taskId: string, checkId: string) {
    return this.run(() => this.api.approve(taskId, checkId));
  }

  protected withdraw(taskId: string) {
    return this.run(() => this.api.withdraw(taskId));
  }

  protected settle(applicationId: string, submitted: boolean) {
    return this.run(() => this.api.settle(applicationId, submitted));
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
