import { formatDate } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, input, output, signal } from '@angular/core';
import type { AlertKind, AlertStats, CatalogEntry, Source } from '@jsa/shared';
import { SourcesApi, errorMessage } from './sources-api';

const kindLabels: Record<AlertKind, string> = {
  job_alert: 'Job alerts',
  job_recommendation: 'Job recommendations',
  company_career_alert: 'Company career alerts',
  freelance_alert: 'Freelance job alerts',
  recruiter_opportunity: 'Recruiter messages',
};

type Status = 'detected' | 'none' | 'review';

const statusLabels: Record<Status, string> = {
  detected: 'Detected',
  none: 'No alerts found',
  review: 'Needs review',
};

/** One job-alert source (T20): whether it is used, who sends its emails, what was imported. */
@Component({
  selector: 'app-alert-source',
  template: `
    @let e = entry();
    @let a = e.alert!;
    <div class="head">
      <label>
        <input
          #use
          type="checkbox"
          [checked]="inUse()"
          [disabled]="busy()"
          (change)="setUsed(use)"
        />
        <strong>{{ e.name }}</strong>
      </label>
      <span class="kind">{{ kindLabel() }}</span>
      <span class="status badge" [class]="status()">{{ statusLabel() }}</span>
    </div>
    <p class="meta">From {{ a.senders.join(', ') }}. {{ imported() }}</p>
    <details>
      <summary>About {{ e.name }}</summary>
      <p>{{ e.note }}</p>
      <p>
        @if (e.terms; as terms) {
          Terms checked
          <a [href]="terms.url" target="_blank" rel="noopener noreferrer">{{ terms.checkedOn }}</a
          >.
        }
        The app never requests this site.
      </p>
    </details>
    @if (busy() || message()) {
      <p role="status">{{ busy() ? 'Saving source selection…' : message() }}</p>
    }
    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--line);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      align-items: baseline;
    }
    .kind,
    .meta,
    details {
      font-size: 14px;
    }
    .meta {
      margin: 0.25rem 0;
      overflow-wrap: anywhere;
    }
    .detected {
      color: var(--info-text);
      background: var(--info-bg);
    }
    .review {
      color: var(--warn-text);
      background: var(--warn-bg);
    }
  `,
})
export class AlertSource {
  private readonly api = inject(SourcesApi);
  private readonly locale = inject(LOCALE_ID);

  readonly entry = input.required<CatalogEntry>();
  /** The user's source of this entry, if they turned it on or off or imported an email. */
  readonly source = input.required<Source | undefined>();
  readonly stats = input.required<AlertStats | undefined>();
  readonly changed = output();

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly message = signal('');

  /** Most sources are used until turned off; recruiter messages only once turned on. */
  protected readonly inUse = computed(
    () => this.source()?.enabled ?? this.entry().alert?.onByDefault ?? false,
  );
  protected readonly kindLabel = computed(() => kindLabels[this.entry().alert!.kind]);
  protected readonly status = computed<Status>(() => {
    const stats = this.stats();
    if (!stats?.emails) return 'none';
    return stats.lastHadNoJobs ? 'review' : 'detected';
  });
  protected readonly statusLabel = computed(() => statusLabels[this.status()]);

  protected readonly imported = computed(() => {
    const stats = this.stats();
    if (!stats?.emails) return 'No email imported yet.';
    const emails = stats.emails === 1 ? '1 email' : `${stats.emails} emails`;
    const newest = stats.lastSentAt
      ? `, the newest sent ${formatDate(stats.lastSentAt, 'd MMM y', this.locale)}`
      : '';
    const review = stats.lastHadNoJobs
      ? ' No job could be read from the last one; the app may not know its layout yet.'
      : '';
    return `${emails} imported${newest}.${review}`;
  });

  protected async setUsed(box: HTMLInputElement) {
    if (this.busy()) return;
    this.message.set('');
    const source = this.source();
    this.busy.set(true);
    this.failure.set('');
    try {
      await (source
        ? this.api.setEnabled(source.id, box.checked)
        : this.api.add(this.entry().id, undefined, box.checked));
      this.message.set(
        box.checked
          ? 'Source enabled for emails you import.'
          : 'Source disabled. Its emails will not be imported.',
      );
    } catch (error) {
      box.checked = !box.checked;
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
      this.changed.emit();
    }
  }
}
