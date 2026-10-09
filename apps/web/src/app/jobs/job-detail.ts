import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { DraftKind, JobDetail, JobVerdict, ModelUsage } from '@jsa/shared';
import { JobForm } from '../answers/job-form';
import { JobApplicationsView } from '../applications/job-applications';
import { JobFill } from '../runner/job-fill';
import { errorMessage } from '../sources/sources-api';
import { criterionLabels, describeResult } from './criteria-text';
import { JobDrafts, draftNames } from './job-drafts';
import { JobSummaryView, outcomeLabels } from './job-summary';
import { JobsApi, usd } from './jobs-api';
import { PasteTextForm } from './paste-text-form';
import { findQuote } from './quote-span';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const textOrigins: Record<string, string> = {
  paste: 'Pasted',
  desktop_save: 'Saved from its page in the desktop app',
};

const verdictLines: Record<JobVerdict, string> = {
  eligible: 'Eligible: no hard criterion rules it out or is unknown.',
  to_confirm: 'To confirm: the job does not say enough for a hard criterion.',
  ineligible: 'Ruled out by a hard criterion.',
};

@Component({
  selector: 'app-job-detail',
  imports: [
    DatePipe,
    JobApplicationsView,
    JobDrafts,
    JobFill,
    JobForm,
    JobSummaryView,
    PasteTextForm,
    RouterLink,
  ],
  template: `
    <p><a routerLink="/jobs">All jobs</a></p>
    @if (data.hasValue()) {
      @let job = data.value();
      <h1>{{ job.title }}</h1>
      <p>
        {{ job.company ?? job.sources[0]?.param ?? 'Company not given' }} ·
        {{ job.location || 'No location given' }}
        @if (job.url) {
          · <a [href]="job.url" target="_blank" rel="noopener noreferrer">Job page</a>
        }
      </p>
      <p>{{ listing() }}</p>
      @if (job.alerts.length) {
        <section aria-labelledby="alerts-heading">
          <h2 id="alerts-heading">In job-alert emails</h2>
          <ul>
            @for (alert of job.alerts; track alert.catalogId + alert.url) {
              <li>
                {{ alert.name
                }}{{ alert.sentAt ? ', sent ' + (alert.sentAt | date: 'd MMM y') : '' }} ·
                @if (alert.url) {
                  <a [href]="alert.url" target="_blank" rel="noopener noreferrer"
                    >The job on {{ alert.name }}</a
                  >
                } @else {
                  The email links to the job only through its own tracker; open the job from the
                  email.
                }
                <span class="details">Subject: {{ alert.subject || 'none' }}</span>
                @if (alert.details) {
                  <span class="details">{{ alert.details }}</span>
                }
              </li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading">Your criteria</h2>
        <p>
          <strong>{{ verdictLines[job.verdict] }}</strong
          >&ngsp;<a routerLink="/criteria">Change your criteria</a>
        </p>
        @if (job.criteria.length) {
          <ul>
            @for (result of job.criteria; track result.criterion) {
              <li>
                <span class="tag">{{ outcomeLabels[result.outcome] }}</span>
                {{ describeResult(result) }}
                @if (result.quote && job.snapshot) {
                  <button
                    type="button"
                    class="inline"
                    [attr.aria-label]="
                      'Show the quote for ' + criterionLabels[result.criterion] + ' in the job text'
                    "
                    (click)="showQuote(result.quote)"
                  >
                    Show in the job text
                  </button>
                }
              </li>
            }
          </ul>
        } @else {
          <p>You have no criteria in use, so every job is eligible.</p>
        }
      </section>

      <section aria-labelledby="text-heading">
        <h2 id="text-heading">Job text</h2>
        @if (job.snapshot; as snapshot) {
          <p>
            {{ textOrigins[snapshot.catalogId] ?? 'Read from the job board' }}
            {{ snapshot.capturedAt | date: 'd MMM y' }}.
            @if (job.earlierSnapshots) {
              {{ plural(job.earlierSnapshots, 'earlier version') }} kept.
            }
          </p>
          @if (job.canImport) {
            <button type="button" [disabled]="busy()" (click)="importText()">
              Check for a newer version
            </button>
          }
          <details [open]="textOpen()" (toggle)="textOpen.set(details.open)" #details>
            <summary>Show the job text</summary>
            @if (highlight(); as h) {
              <pre
                class="jd">{{ h.before }}<mark id="jd-quote" tabindex="-1">{{ h.quote }}</mark>{{ h.after }}</pre>
            } @else {
              <pre class="jd">{{ snapshot.text }}</pre>
            }
          </details>
        } @else if (job.canImport) {
          <p>The job text has not been read yet.</p>
          <button type="button" [disabled]="busy()" (click)="importText()">
            Read the job text
          </button>
        } @else {
          <p>
            @if (job.saved) {
              The app has only what a results page showed about this job, so it does not summarise
              it yet. Open the job page in the desktop app and press “Save this job”, or paste the
              job text here.
            } @else if (job.alerts.length && !job.url) {
              The app has only what a job-alert email showed about this job, and no link to it, so
              it does not summarise it yet. Open the job from the email, then paste its text here
              with the link, or open it in the desktop app and press “Save this job”.
            } @else if (job.alerts.length) {
              The app has only what a job-alert email showed about this job, so it does not
              summarise it yet. Paste the job text here, or open the job page in the desktop app and
              press “Save this job”.
            } @else {
              None of the sources you use lists this job now, so the app cannot read its text. You
              can paste it here.
            }
          </p>
          <app-paste-text-form [jobId]="job.id" [needsLink]="!job.url" (saved)="data.set($event)" />
        }
      </section>

      @if (job.snapshot || job.canImport) {
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading">Summary</h2>
          @if (job.snapshot?.summary) {
            <app-job-summary
              [snapshot]="job.snapshot!"
              (changed)="data.set($event)"
              (showQuote)="showQuote($event)"
            />
          } @else {
            <p>
              Summarising sends the job text, and nothing about you, to DeepSeek in one request.
              Every point of the summary quotes the job text.
              @if (!job.snapshot) {
                The app reads the job text from the job board first.
              }
            </p>
            <button type="button" [disabled]="busy()" (click)="summarise()">
              Summarise with DeepSeek
            </button>
            @if (usage.hasValue()) {
              <p class="hint">{{ usageLine() }}</p>
            }
          }
        </section>
      }

      @if (job.snapshot?.summary || job.snapshot?.requirements?.length) {
        <section aria-labelledby="match-heading">
          <h2 id="match-heading">Match with your facts</h2>
          @if (job.snapshot!.match; as m) {
            <p>
              Matched by {{ m.model }} on {{ m.createdAt | date: 'd MMM y' }} with
              {{ plural(m.factsSent, 'fact') }}, about {{ usd(m.costUsd) }}. Each requirement above
              shows what it found.
            </p>
            @if (m.outdated.length) {
              <p>{{ m.outdated.join(' ') }} Match again to use the change.</p>
            }
          } @else {
            <p>
              Matching sends this job’s requirements whose quotes are in its text, and the
              {{ plural(job.factsToSend, 'fact') }} you allowed to go to DeepSeek, in one request;
              nothing else about you. DeepSeek says for each requirement whether your facts meet it
              and which facts it rests on; an answer that cites none of them counts as unknown.
            </p>
          }
          @if (!job.snapshot!.match || job.snapshot!.match.outdated.length) {
            @if (job.factsToSend === 0) {
              <p>
                None of your facts may be sent yet. Confirm facts and allow them to go to DeepSeek
                on the <a routerLink="/facts">Facts</a> page.
              </p>
            }
            <button
              type="button"
              [disabled]="busy() || job.factsToSend === 0"
              (click)="match(job.snapshot!.id)"
            >
              {{ job.snapshot!.match ? 'Match again' : 'Match with my facts' }}
            </button>
          }
        </section>
      }

      @if (job.snapshot) {
        <section aria-labelledby="drafts-heading">
          <h2 id="drafts-heading">Drafts</h2>
          <app-job-drafts
            [job]="job"
            [busy]="busy()"
            (write)="writeDraft(job.snapshot.id, $event)"
          />
        </section>
      }

      <section aria-labelledby="form-heading">
        <h2 id="form-heading">Application form</h2>
        <app-job-form [jobId]="job.id" (formChanged)="jobFill.refresh()" />
        <app-job-fill #jobFill [jobId]="job.id" (applicationChanged)="jobApplications.refresh()" />
      </section>

      <section aria-labelledby="applications-heading">
        <h2 id="applications-heading">Applications</h2>
        <app-job-applications #jobApplications [jobId]="job.id" (recorded)="jobFill.refresh()" />
      </section>

      <p role="status">{{ status() }}</p>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading the job…</p>
    } @else {
      <p class="error" role="alert">The job could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    .details {
      display: block;
      font-size: 0.9rem;
    }
    .jd {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: inherit;
    }
    .hint {
      font-size: 0.9rem;
    }
    .tag {
      font-size: 0.8rem;
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
    }
    .inline {
      margin-left: 0.5rem;
    }
    mark {
      scroll-margin: 4rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class JobDetailPage {
  private readonly api = inject(JobsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly data = httpResource<JobDetail>(() => `/api/jobs/${this.id()}`);
  protected readonly usage = httpResource<ModelUsage>(() => '/api/model-usage');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly failure = signal('');
  protected readonly plural = plural;
  protected readonly usd = usd;
  protected readonly textOrigins = textOrigins;
  protected readonly verdictLines = verdictLines;
  protected readonly outcomeLabels = outcomeLabels;
  protected readonly describeResult = describeResult;
  protected readonly criterionLabels = criterionLabels;

  protected readonly textOpen = signal(false);
  /** The quote the user asked to see, marked in the job text. */
  private readonly shownQuote = signal<string | null>(null);
  protected readonly highlight = computed(() => {
    const text = this.data.value()?.snapshot?.text;
    const quote = this.shownQuote();
    const at = text && quote ? findQuote(text, quote) : undefined;
    if (!text || !at) return undefined;
    return {
      before: text.slice(0, at.start),
      quote: text.slice(at.start, at.end),
      after: text.slice(at.end),
    };
  });

  protected readonly listing = computed(() => {
    const job = this.data.value();
    if (!job) return '';
    const saved = 'You saved this job in the desktop app.';
    if (job.sources.length) {
      const listed = `Listed by ${job.sources.map((s) => s.param).join(', ')}.`;
      return job.saved ? `${listed} ${saved}` : listed;
    }
    if (job.saved) return saved;
    if (job.alerts.length) return 'No job board you use lists this job.';
    return job.snapshot?.catalogId === 'paste'
      ? 'You pasted this job.'
      : 'No source you use lists this job now.';
  });

  protected readonly usageLine = computed(() => {
    const u = this.usage.value();
    if (!u) return '';
    return `DeepSeek use so far: ${plural(u.calls, 'request')}, ${u.failed} failed, about ${usd(u.costUsd)}.`;
  });

  /** Opens the job text with the quote marked, and moves to it. */
  protected showQuote(quote: string) {
    const text = this.data.value()?.snapshot?.text ?? '';
    if (!findQuote(text, quote)) {
      this.failure.set('That quote is not in the current job text.');
      return;
    }
    this.failure.set('');
    this.shownQuote.set(quote);
    this.textOpen.set(true);
    afterNextRender(
      () => {
        const mark = this.host.nativeElement.querySelector<HTMLElement>('#jd-quote');
        mark?.scrollIntoView?.({ block: 'center' });
        mark?.focus();
      },
      { injector: this.injector },
    );
  }

  protected async match(snapshotId: string) {
    await this.run('Matching with your facts on DeepSeek. This can take a minute.', () =>
      this.api.match(snapshotId),
    );
    this.usage.reload();
  }

  protected async writeDraft(snapshotId: string, kind: DraftKind) {
    this.busy.set(true);
    this.failure.set('');
    this.status.set(`Writing the ${draftNames[kind]} with DeepSeek. This can take a minute.`);
    try {
      const draft = await this.api.writeDraft(snapshotId, kind);
      this.status.set('');
      await this.router.navigate(['/drafts', draft.id]);
    } catch (error) {
      this.status.set('');
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
      this.usage.reload();
    }
  }

  protected importText() {
    return this.run('Reading the job text from the job board…', () =>
      this.api.importText(this.id()),
    );
  }

  protected async summarise() {
    await this.run('Summarising with DeepSeek. This can take a minute.', async () => {
      const job = this.data.value()?.snapshot ? this.data.value()! : await this.importAndShow();
      return this.api.summarise(job.snapshot!.id);
    });
    this.usage.reload();
  }

  private async importAndShow() {
    const job = await this.api.importText(this.id());
    this.data.set(job);
    return job;
  }

  private async run(working: string, change: () => Promise<JobDetail>) {
    this.busy.set(true);
    this.failure.set('');
    this.status.set(working);
    try {
      this.data.set(await change());
      this.status.set('');
    } catch (error) {
      this.status.set('');
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
