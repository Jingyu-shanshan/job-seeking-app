import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApplicationsResponse } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { methodLabels, statusLabels } from './labels';

/** Every application, newest first (T09). Only “Applied” counts as having applied. */
@Component({
  selector: 'app-applications',
  imports: [DatePipe, RouterLink],
  template: `
    <h1>Applications</h1>
    <p class="hint">
      An application counts as applied only when it went in: Greenhouse confirmed the runner’s
      submission, you said a submission whose result was unknown went through, or you recorded one
      you sent outside the app. Each keeps the job text, the match, the files and the facts it was
      built from, as they were then.
    </p>
    @if (data.hasValue()) {
      @let applications = data.value().applications;
      @if (applications.length) {
        <ul>
          @for (a of applications; track a.id) {
            <li>
              <a class="title" [routerLink]="['/applications', a.id]">{{ a.title }}</a>
              <span class="meta">
                {{ a.company ?? 'Company not given' }} · {{ statusLabels[a.status] }},
                {{ methodLabels[a.method] }},
                {{ a.submittedAt ?? a.createdAt | date: 'd MMM y, HH:mm' }}
              </span>
            </li>
          }
        </ul>
      } @else {
        <p>No applications yet.</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading…</p>
    } @else {
      <p class="error" role="alert">The applications could not be loaded. {{ loadError() }}</p>
    }
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
    .hint {
      display: block;
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Applications {
  protected readonly data = httpResource<ApplicationsResponse>(() => '/api/applications');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly statusLabels = statusLabels;
  protected readonly methodLabels = methodLabels;
}
