import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Job, JobOrigin, JobVerdict } from '@jsa/shared';
import { describeResult, listedResults } from './criteria-text';

/** Jobs as links to their pages, with where, when, and why they are grouped where they are. */
@Component({
  selector: 'app-job-list',
  imports: [DatePipe, RouterLink],
  template: `
    <ul>
      @for (job of jobs(); track job.id) {
        <li>
          <a class="title" [routerLink]="['/jobs', job.id]">{{ job.title }}</a>
          <span class="badge" [class.warning]="job.verdict === 'to_confirm'">
            {{ verdictLabels[job.verdict] }}
          </span>
          @if (job.application === 'submitted') {
            &ngsp;<span class="applied">Applied</span>
          } @else if (job.application === 'to_verify') {
            &ngsp;<span class="badge warning">Application result unknown</span>
          }
          <span class="meta">
            {{ job.company ?? job.sources[0]?.param ?? 'Company not given' }} ·
            {{ job.location || 'No location given' }}
            @if (job.url) {
              · <a [href]="job.url" target="_blank" rel="noopener noreferrer">Job page</a>
            }
          </span>
          <span class="meta">
            @if (job.publishedAt) {
              Posted {{ job.publishedAt | date: dateFormat }} ·
            }
            {{ originLabels[job.origin] }} {{ job.firstSeenAt | date: dateFormat }}
            @if (job.sources.length > 1) {
              · Listed by {{ job.sources.length }} of your sources
            }
            @if (job.alerts.length) {
              · In alert emails from {{ job.alerts.join(', ') }}
            }
          </span>
          @if (job.needsText) {
            <span class="reason">
              {{
                job.url
                  ? 'Needs the job text: paste it, or save its page.'
                  : 'Needs the job text and link: open the job from the email, then paste its text or save its page.'
              }}
            </span>
          }
          @for (result of listedResults(job.criteria); track result.criterion) {
            <span class="reason">{{ describeResult(result) }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      padding-left: 0;
      list-style: none;
    }
    li {
      padding: 20px 0;
      border-bottom: 1px solid var(--line);
    }
    .title {
      font-size: 17px;
      font-weight: 650;
    }
    .badge,
    .applied {
      margin-left: 0.5rem;
    }
    .badge.warning {
      padding: 4px 8px;
      border-radius: 4px;
    }
    .meta,
    .reason {
      display: block;
      font-size: 14px;
    }
    .reason {
      margin-top: 8px;
      color: var(--muted);
    }
  `,
})
export class JobList {
  readonly jobs = input.required<Job[]>();

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
