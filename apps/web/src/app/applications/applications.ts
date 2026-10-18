import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApplicationsResponse } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { methodLabels, statusLabels, statusNotes } from './labels';

/** Every application, newest first (T09). Only “Applied” counts as having applied. */
@Component({
  selector: 'app-applications',
  imports: [DatePipe, RouterLink],
  template: `
    <h1>Applications</h1>
    <p>
      What went out, with the job text, files and fact versions kept as they were then. Writing a
      draft does not count as applying.
    </p>
    <details>
      <summary>When an application counts as applied</summary>
      <p>
        Greenhouse confirmed the runner’s submission, you verified that an unknown result went
        through, or you recorded an application you sent outside the app.
      </p>
    </details>
    @if (data.hasValue()) {
      @let applications = data.value().applications;
      @if (applications.length) {
        <ul>
          @for (a of applications; track a.id) {
            <li>
              <span
                class="tag"
                [class.applied]="a.status === 'submitted'"
                [class.todo]="a.status === 'to_verify'"
                >{{ statusLabels[a.status] }}</span
              >
              <h2>
                <a [routerLink]="['/applications', a.id]">{{ a.title }}</a>
              </h2>
              <p>{{ a.company ?? 'Company not given' }} · {{ methodLabels[a.method] }}</p>
              <p class="meta">
                @if (a.status === 'submitted') {
                  Submitted {{ a.submittedAt | date: 'd MMM y, HH:mm' }}
                } @else {
                  Submit attempted {{ a.createdAt | date: 'd MMM y, HH:mm' }}
                }
              </p>
              <p>{{ statusNotes[a.status] }}</p>
              @if (a.status === 'to_verify') {
                <a class="button" [routerLink]="['/jobs', a.jobId]" fragment="application-heading"
                  >Verify on the job page</a
                >
              }
            </li>
          }
        </ul>
      } @else {
        <h2>No applications recorded</h2>
        <p>
          Choose a job and review its materials and form, or record an application you already sent
          outside the app.
        </p>
        <a class="button primary" routerLink="/jobs">Choose a job</a>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading applications…</p>
    } @else {
      <p class="error" role="alert">The applications could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
    }
  `,
  styles: `
    ul {
      padding-left: 0;
      list-style: none;
    }
    li {
      padding: 24px 0;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 12px 0 8px;
    }
    li p {
      margin-bottom: 8px;
    }
  `,
})
export class Applications {
  protected readonly data = httpResource<ApplicationsResponse>(() => '/api/applications');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly statusLabels = statusLabels;
  protected readonly methodLabels = methodLabels;
  protected readonly statusNotes = statusNotes;
}
