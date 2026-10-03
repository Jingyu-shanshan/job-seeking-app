import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Job, JobOrigin } from '@jsa/shared';
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
          <span class="meta">
            {{ job.company ?? job.sources[0]?.param ?? 'Company not given' }} ·
            {{ job.location || 'No location given' }} ·
            <a [href]="job.url" target="_blank" rel="noopener noreferrer">Job page</a>
          </span>
          <span class="meta">
            @if (job.publishedAt) {
              Posted {{ job.publishedAt | date: dateFormat }} ·
            }
            {{ originLabels[job.origin] }} {{ job.firstSeenAt | date: dateFormat }}
            @if (job.sources.length > 1) {
              · Listed by {{ job.sources.length }} of your sources
            }
          </span>
          @if (job.needsText) {
            <span class="reason">Needs the job text: save its page or paste it.</span>
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
      margin-bottom: 0.75rem;
    }
    .title {
      font-weight: 600;
    }
    .meta,
    .reason {
      display: block;
      font-size: 0.9rem;
    }
    .reason {
      font-style: italic;
    }
  `,
})
export class JobList {
  readonly jobs = input.required<Job[]>();

  protected readonly dateFormat = 'd MMM y';
  protected readonly listedResults = listedResults;
  protected readonly describeResult = describeResult;
  protected readonly originLabels: Record<JobOrigin, string> = {
    discovered: 'Found',
    pasted: 'Pasted',
    saved: 'Saved',
  };
}
