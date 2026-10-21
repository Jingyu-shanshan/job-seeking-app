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
      <nav aria-label="Job stages">
        <ol class="stages">
          @for (step of stages(); track step.id) {
            <li>
              <a
                [href]="'#' + step.id + '-heading'"
                [attr.aria-current]="nextStep().id === step.id ? 'step' : null"
                (click)="$event.preventDefault(); goToSection(step.id)"
                >{{ step.label }}</a
              >
            </li>
          }
        </ol>
      </nav>
      <section class="next-step" aria-labelledby="next-heading">
        <h2 id="next-heading">{{ nextStep().title }}</h2>
        <p>{{ nextStep().note }}</p>
        <a
          class="button primary"
          [href]="'#' + nextStep().id + '-heading'"
          (click)="$event.preventDefault(); goToSection(nextStep().id)"
          >{{ nextStep().label }}</a
        >
      </section>

      <p role="status">{{ status() }}</p>
      @if (failure()) {
        <p class="error" role="alert" tabindex="-1" id="job-action-error">{{ failure() }}</p>
        <p class="hint">
          Your saved text and results are kept. Review the message before retrying. A model retry
          may use another paid request; recorded usage is shown below.
        </p>
      }
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
        <h2 id="criteria-heading" tabindex="-1">Your criteria</h2>
        <p>
          <strong>{{ verdictLines[job.verdict] }}</strong
          >&ngsp;<a routerLink="/criteria">Change your criteria</a>
        </p>
        @if (job.criteria.length) {
          <ul>
            @for (result of job.criteria; track result.criterion) {
              <li>
                <span class="tag" [class.todo]="result.outcome === 'unknown'">{{
                  outcomeLabels[result.outcome]
                }}</span>
                {{ describeResult(result) }}
                @if (result.quote && job.snapshot) {
                  <button
                    type="button"
                    class="inline"
                    [attr.aria-label]="'Show in the job text: ' + criterionLabels[result.criterion]"
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
        <h2 id="text-heading" tabindex="-1">Job text</h2>
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
          } @else {
            <p class="hint">
              This source cannot be read again here. Open the original page or email to check for
              changes; paste a newer description below or save its page in the desktop app.
            </p>
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
          <app-paste-text-form
            [jobId]="job.id"
            [needsLink]="!job.url"
            [busy]="busy()"
            (saved)="data.set($event)"
          />
        }
        @if (job.canImport || job.snapshot) {
          <details>
            <summary>Paste original text instead</summary>
            <p>
              Saving keeps earlier versions. Use the full description from the job page, not a
              listing or email snippet. Saving does not call DeepSeek.
            </p>
            <app-paste-text-form
              [jobId]="job.id"
              [needsLink]="!job.url"
              [busy]="busy()"
              (saved)="data.set($event)"
            />
          </details>
        }
      </section>

      @if (job.snapshot || job.canImport) {
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" tabindex="-1">Summary</h2>
          @if (job.snapshot?.summary) {
            <app-job-summary
              [snapshot]="job.snapshot!"
              [pageBusy]="busy()"
              (changed)="data.set($event)"
              (showQuote)="showQuote($event)"
            />
          } @else {
            <p>
              Summarising sends the job text, and nothing about you, to DeepSeek in one request.
              Every point of the summary quotes the job text. This is a paid request processed
              outside the EU; its cost is recorded afterwards.
              @if (!job.snapshot) {
                The app reads the job text from the job board first.
              }
            </p>
            <button type="button" [disabled]="busy()" (click)="summarise()">
              Summarise with DeepSeek
            </button>
          }
          <p class="hint">{{ usageLine() }}</p>
        </section>
      }

      @if (job.snapshot?.summary || job.snapshot?.requirements?.length) {
        <section aria-labelledby="match-heading">
          <h2 id="match-heading" tabindex="-1">Match with your facts</h2>
          @if (job.snapshot!.match; as m) {
            <p>
              Matched by {{ m.model }} on {{ m.createdAt | date: 'd MMM y' }} with
              {{ plural(m.factsSent, 'fact') }}, about {{ usd(m.costUsd) }}. Each requirement above
              shows what it found.
            </p>
            @if (m.outdated.length) {
              <p class="warning">{{ m.outdated.join(' ') }} Match again to use the change.</p>
            }
          }
          @if (!job.snapshot!.match || job.snapshot!.match.outdated.length) {
            <p>
              Matching sends this job’s requirements whose quotes are in its text, and the
              {{ plural(job.factsToSend, 'fact') }} you allowed to go to DeepSeek, in one request;
              nothing else about you. DeepSeek says for each requirement whether your facts meet it
              and which facts it rests on; an answer that cites none of them counts as unknown. This
              is a paid request processed outside the EU; its cost is recorded afterwards.
            </p>
            @if (job.factsToSend === 0) {
              <p>
                None of your facts may be sent yet. Confirm facts and allow them to go to DeepSeek
                on the <a routerLink="/facts">Facts</a> page.
              </p>
            }
            @if (!hasRequirements()) {
              <p class="warning">
                No requirements have a verified quote yet. Correct or add a requirement in Summary
                before matching.
              </p>
            }
            <button
              type="button"
              [disabled]="busy() || job.factsToSend === 0 || !hasRequirements()"
              (click)="match(job.snapshot!.id)"
            >
              {{ job.snapshot!.match ? 'Match again' : 'Match with my facts' }}
            </button>
          }
          <p class="hint">{{ usageLine() }}</p>
        </section>
      }

      @if (job.snapshot) {
        <section aria-labelledby="drafts-heading">
          <h2 id="drafts-heading" tabindex="-1">Drafts</h2>
          <app-job-drafts
            [job]="job"
            [busy]="busy()"
            (write)="writeDraft(job.snapshot.id, $event)"
          />
          <p class="hint">{{ usageLine() }}</p>
        </section>
      }

      <section aria-labelledby="form-heading">
        <h2 id="form-heading" tabindex="-1">Application form</h2>
        <p>
          Review required answers and your <a routerLink="/profile">Your details</a>. Reusable
          answers are on <a routerLink="/answers">Form answers</a>. Filling stops before Submit;
          each application still needs your approval below.
        </p>
        <app-job-form [jobId]="job.id" (formChanged)="jobFill.refresh()" />
        <app-job-fill #jobFill [jobId]="job.id" (applicationChanged)="jobApplications.refresh()" />
      </section>

      <section aria-labelledby="applications-heading">
        <h2 id="applications-heading" tabindex="-1">Applications</h2>
        <app-job-applications #jobApplications [jobId]="job.id" (recorded)="jobFill.refresh()" />
      </section>

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading">Recorded model usage</h2>
        @if (usage.hasValue()) {
          <p>{{ usageLine() }}</p>
          <p class="hint">
            {{ usage.value().inputTokens }} input tokens · {{ usage.value().outputTokens }} output
            tokens. Recorded account totals are estimates, not a quote for the next request. Failed
            requests are not reset by retrying.
          </p>
        } @else if (usage.isLoading()) {
          <p role="status">Loading recorded usage…</p>
        } @else {
          <p class="error" role="alert">Recorded usage could not be loaded.</p>
          <button type="button" (click)="usage.reload()">Retry usage</button>
        }
      </section>
    } @else if (data.isLoading()) {
      <h1>Job</h1>
      <p role="status">Loading the job…</p>
    } @else {
      <h1>Job unavailable</h1>
      <p class="error" role="alert">The job could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
    }
  `,
  styles: `
    .stages {
      display: flex;
      flex-wrap: wrap;
      list-style: none;
      gap: 8px 20px;
      padding: 0;
      margin: 24px 0;
    }
    .stages a {
      display: inline-block;
      padding: 10px 0;
      min-height: 44px;
    }
    [aria-current='step'] {
      font-weight: 650;
      text-decoration-thickness: 2px;
    }
    .next-step {
      padding: 20px;
      border-radius: 12px;
      background: var(--surface);
      margin-bottom: 24px;
    }
    .next-step h2 {
      margin-top: 0;
    }
    h2 {
      scroll-margin-top: 24px;
    }
    .details {
      display: block;
      font-size: 14px;
    }
    .jd {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: inherit;
    }
    .inline {
      margin-left: 0.5rem;
    }
    mark {
      scroll-margin: 4rem;
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

  protected readonly hasRequirements = computed(
    () => this.data.value()?.snapshot?.requirements.some((r) => r.quoteVerified) ?? false,
  );

  protected readonly stages = computed(() => {
    const job = this.data.value();
    return [
      { id: 'criteria', label: 'Criteria' },
      { id: 'text', label: 'Source text' },
      ...(job?.snapshot || job?.canImport ? [{ id: 'summary', label: 'Summary' }] : []),
      ...(job?.snapshot?.summary || job?.snapshot?.requirements.length
        ? [{ id: 'match', label: 'Match' }]
        : []),
      ...(job?.snapshot ? [{ id: 'drafts', label: 'Drafts' }] : []),
      { id: 'form', label: 'Form and approval' },
      { id: 'applications', label: 'Applications' },
    ];
  });

  protected readonly nextStep = computed(() => {
    const job = this.data.value();
    if (job?.verdict === 'ineligible')
      return {
        id: 'criteria',
        title: 'Review why this job is ruled out',
        label: 'Review criteria',
        note: 'A hard criterion rules this job out. Read the reason before spending time or paid model requests on it.',
      };
    if (!job?.snapshot)
      return {
        id: 'text',
        title: 'Get the original job text',
        label: job?.canImport ? 'Read source text' : 'Add source text',
        note: 'A listing or email snippet is not the full description. Read a supported board, paste the original text or save its page in the desktop app.',
      };
    if (!job.snapshot.summary)
      return {
        id: 'summary',
        title: 'Summarise the current text',
        label: 'Review summary action',
        note: 'Check the original description, then request a quoted summary. Earlier text versions are kept; results belong to their own version.',
      };
    if (!this.hasRequirements())
      return {
        id: 'summary',
        title: 'Check the job requirements',
        label: 'Review requirements',
        note: 'No requirement has a verified quote. Correct or add requirements before matching; unknown information does not count as met.',
      };
    if (!job.snapshot.match || job.snapshot.match.outdated.length)
      return {
        id: 'match',
        title: job.snapshot.match ? 'Update the evidence match' : 'Match the requirements',
        label: 'Review match action',
        note:
          job.factsToSend === 0
            ? 'Matching is blocked: confirm facts and allow them to go to DeepSeek on Facts. Drafts also need permission to appear in materials.'
            : 'Review the facts permitted for DeepSeek. Missing evidence stays unknown; an old match does not prove the current requirements are met.',
      };
    if (
      ['resume', 'cover_letter'].every((kind) =>
        job.snapshot!.drafts.some(
          (draft) => draft.kind === kind && !draft.outdated.length && draft.pdfs > 0,
        ),
      )
    )
      return {
        id: 'form',
        title: 'Prepare the application form',
        label: 'Review form and answers',
        note: 'PDFs have been kept for these drafts. Confirm they still match the latest documents, check your details and required answers, then review the actual filled form before approving this application.',
      };
    return {
      id: 'drafts',
      title: 'Prepare and review your drafts',
      label: 'Review drafts',
      note:
        job.factsToDraft === 0
          ? 'Writing is blocked: confirm facts and allow both DeepSeek and material use on Facts. Existing drafts remain available to review.'
          : 'Read each current draft and its evidence, then prepare PDFs and the form. A generated draft or kept PDF does not mean you reviewed or submitted it.',
    };
  });

  protected goToSection(id: string) {
    const heading = this.host.nativeElement.querySelector<HTMLElement>(`#${id}-heading`);
    heading?.focus();
    heading?.scrollIntoView?.({ block: 'start' });
  }

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
    const saved = 'You saved this job.';
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
    if (!u)
      return this.usage.isLoading()
        ? 'Loading recorded DeepSeek usage…'
        : 'Recorded DeepSeek usage is unavailable; retry below.';
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
      await this.router.navigate(['/drafts', draft.id], { queryParamsHandling: 'preserve' });
    } catch (error) {
      this.status.set('');
      this.failure.set(errorMessage(error));
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('#job-action-error')?.focus(),
        { injector: this.injector },
      );
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
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('#job-action-error')?.focus(),
        { injector: this.injector },
      );
    } finally {
      this.busy.set(false);
    }
  }
}
