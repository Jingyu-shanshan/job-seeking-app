import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Job, JobOrigin, JobVerdict } from '@jsa/shared';
import { describeResult, listedResults } from './criteria-text';

/** A scannable job table, retaining criteria evidence and application warnings. */
@Component({
  selector: 'app-job-list',
  imports: [DatePipe, RouterLink],
  template: `
    <p class="scroll-hint hint">Scroll horizontally to see dates and delete actions.</p>
    <div class="table-scroll" role="region" aria-label="Job table" tabindex="0">
      <table>
        <caption class="sr-only">
          Jobs with eligibility, application status and dates
        </caption>
        <thead>
          <tr>
            <th scope="col">Job / company</th>
            <th scope="col">Status</th>
            <th scope="col">Dates</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (job of jobs(); track job.id) {
            <tr>
              <td class="job">
                <a class="title" [routerLink]="['/jobs', job.id]">{{ job.title }}</a>
                <span class="company">{{
                  job.company ?? job.sources[0]?.param ?? 'Company not given'
                }}</span>
                <span class="meta">{{ job.location || 'No location given' }}</span>
                @if (job.url) {
                  <a class="source-link" [href]="job.url" target="_blank" rel="noopener noreferrer"
                    >Job page</a
                  >
                }
                @if (job.sources.length > 1) {
                  <span class="meta">Listed by {{ job.sources.length }} of your sources</span>
                }
                @if (job.alerts.length) {
                  <span class="meta">In alert emails from {{ job.alerts.join(', ') }}</span>
                }
              </td>
              <td class="state">
                <div class="badges">
                  <span class="badge" [class.warning]="job.verdict === 'to_confirm'">
                    {{ verdictLabels[job.verdict] }}
                  </span>
                  @if (roleMatches(job) && job.verdict !== 'ineligible') {
                    <span class="badge role-match">Role match</span>
                  }
                  @if (job.application === 'submitted') {
                    <span class="applied">Applied</span>
                  } @else if (job.application === 'to_verify') {
                    <span class="badge warning">Application result unknown</span>
                  }
                </div>
                @if (job.needsText) {
                  <span class="reason">{{
                    job.url
                      ? 'Needs the job text: paste it, or save its page.'
                      : 'Needs the job text and link: open the job from the email, then paste its text or save its page.'
                  }}</span>
                }
                @for (result of listedResults(job.criteria); track result.criterion) {
                  <span class="reason">{{ describeResult(result) }}</span>
                }
              </td>
              <td class="dates">
                <span>{{ originLabels[job.origin] }}</span>
                <time [attr.datetime]="job.firstSeenAt">{{
                  job.firstSeenAt | date: dateFormat
                }}</time>
                @if (job.publishedAt) {
                  <span class="meta posted">Posted {{ job.publishedAt | date: dateFormat }}</span>
                }
              </td>
              <td>
                <button
                  type="button"
                  class="danger"
                  [disabled]="busy()"
                  [attr.aria-label]="'Delete ' + job.title"
                  [attr.data-delete-id]="job.id"
                  [attr.aria-expanded]="confirming() === job.id"
                  (click)="askToDelete(job)"
                >
                  Delete
                </button>
              </td>
            </tr>
            @if (confirming() === job.id) {
              <tr class="confirmation">
                <td colspan="4">
                  <div role="group" [attr.aria-label]="'Delete ' + job.title + '?'">
                    <p>
                      <strong>Delete {{ job.title }} from the job list?</strong>
                    </p>
                    <p class="hint">Saved text, drafts and application history are kept.</p>
                    <div class="actions">
                      <button
                        type="button"
                        class="danger"
                        [disabled]="busy()"
                        (click)="deleteRequested.emit(job)"
                      >
                        {{ busy() ? 'Deleting…' : 'Confirm delete' }}
                      </button>
                      <button
                        type="button"
                        class="cancel"
                        [disabled]="busy()"
                        (click)="cancel(job)"
                      >
                        Cancel
                      </button>
                    </div>
                    @if (failure()?.id === job.id) {
                      <p role="alert">
                        Could not delete this job. {{ failure()?.message }} Try again.
                      </p>
                    }
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .table-scroll {
      overflow-x: auto;
      scrollbar-color: var(--control) var(--surface);
    }
    .scroll-hint {
      display: none;
    }
    table {
      width: 100%;
      min-width: 680px;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      text-align: left;
      font-weight: 600;
      color: var(--muted);
      background: var(--layer);
    }
    th,
    td {
      padding: 16px 12px;
      vertical-align: top;
      border-bottom: 1px solid var(--line);
    }
    .job {
      width: 32%;
    }
    .state {
      width: 36%;
    }
    .dates {
      width: 20%;
      font-variant-numeric: tabular-nums;
    }
    .dates > span,
    time {
      display: block;
    }
    .posted {
      margin-top: 8px;
    }
    .title {
      display: inline-block;
      font-size: 16px;
      font-weight: 650;
      margin-bottom: 6px;
    }
    .company,
    .meta,
    .reason {
      display: block;
    }
    .company {
      font-weight: 500;
    }
    .source-link {
      display: inline-block;
      padding-block: 10px;
    }
    .reason {
      margin-top: 8px;
      color: var(--muted);
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge.warning {
      padding: 4px 8px;
      border-radius: 4px;
    }
    button {
      white-space: nowrap;
    }
    .confirmation td {
      background: var(--layer);
    }
    .confirmation p {
      margin-bottom: 8px;
    }
    .confirmation .actions {
      margin: 12px 0 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (hover: hover) and (pointer: fine) {
      tbody > tr:not(.confirmation):hover {
        background: var(--surface);
      }
    }
    @media (max-width: 600px) {
      .scroll-hint {
        display: block;
        margin-bottom: 8px;
      }
      .confirmation [role='group'] {
        max-width: calc(100vw - 72px);
      }
      th,
      td {
        padding: 12px;
      }
    }
  `,
})
export class JobList {
  readonly jobs = input.required<Job[]>();
  readonly deleteRequested = output<Job>();
  readonly busy = input(false);
  readonly failure = input<{ id: string; message: string } | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly confirming = signal<string | null>(null);

  protected askToDelete(job: Job) {
    this.confirming.set(job.id);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLButtonElement>('.cancel')?.focus(),
      { injector: this.injector },
    );
  }

  protected cancel(job: Job) {
    this.confirming.set(null);
    this.host.nativeElement
      .querySelector<HTMLButtonElement>(`button[data-delete-id="${job.id}"]`)
      ?.focus();
  }

  protected readonly roleMatches = (job: Job) =>
    job.criteria.some((result) => result.criterion === 'title' && result.outcome === 'met');
  protected readonly dateFormat = 'd MMM y';
  protected readonly verdictLabels: Record<JobVerdict, string> = {
    eligible: 'Eligible',
    to_confirm: 'To confirm',
    ineligible: 'Ruled out',
  };
  protected readonly listedResults = listedResults;
  protected readonly describeResult = describeResult;
  protected readonly originLabels: Record<JobOrigin, string> = {
    discovered: 'Found',
    saved: 'Saved',
    alert: 'From an alert email',
    pasted: 'Pasted',
  };
}
