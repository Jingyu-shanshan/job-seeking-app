import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import type { Job } from '@jsa/shared';

/** Jobs as links to their pages, with where, when, and why they are grouped where they are. */
@Component({
  selector: 'app-job-list',
  imports: [DatePipe],
  template: `
    <ul>
      @for (job of jobs(); track job.id) {
        <li>
          <a [href]="job.url" target="_blank" rel="noopener noreferrer">{{ job.title }}</a>
          <span class="meta">
            {{ job.company ?? job.sources[0]?.param }} · {{ job.location || 'No location given' }}
          </span>
          <span class="meta">
            @if (job.publishedAt) {
              Posted {{ job.publishedAt | date: dateFormat }} ·
            }
            Found {{ job.firstSeenAt | date: dateFormat }}
            @if (job.sources.length > 1) {
              · Listed by {{ job.sources.length }} of your sources
            }
          </span>
          @if (job.reason) {
            <span class="reason">{{ job.reason }}</span>
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
    a {
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
}
