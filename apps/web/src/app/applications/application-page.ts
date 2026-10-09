import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApplicationRecord, FrozenMatch } from '@jsa/shared';
import { outcomeLabels } from '../jobs/job-summary';
import { errorMessage } from '../sources/sources-api';
import { factKindLabels, kindLabels, methodLabels, statusLabels } from './labels';

const verdictLabels: Record<FrozenMatch['verdict'], string> = {
  eligible: 'your facts met every must-have',
  to_confirm: 'some must-haves were unknown',
  ineligible: 'a must-have was not met',
};

/**
 * One application as it was recorded (T09): the job text, the match, the files that went out, the
 * fact versions they cite, and for the runner the form's values and the page after Submit. Later
 * changes to facts, drafts or the job text do not change any of it; a fact that changed since says
 * so.
 */
@Component({
  selector: 'app-application-page',
  imports: [DatePipe, RouterLink],
  template: `
    <p><a routerLink="/applications">All applications</a></p>
    @if (data.hasValue()) {
      @let a = data.value();
      <h1>{{ a.title }}</h1>
      <p>
        {{ a.company ?? 'Company not given' }} · <a [routerLink]="['/jobs', a.jobId]">Job page</a>
      </p>
      <p>
        <strong>{{ statusLabels[a.status] }}</strong
        >, {{ methodLabels[a.method] }}.
        @if (a.method === 'manual') {
          You sent it on {{ a.submittedAt | date: 'd MMM y, HH:mm' }} and recorded it on
          {{ a.createdAt | date: 'd MMM y, HH:mm' }}.
        } @else {
          The runner pressed Submit on {{ a.createdAt | date: 'd MMM y, HH:mm' }}.
          @switch (a.status) {
            @case ('to_verify') {
              Its result is unknown: say on the job page whether it went through.
            }
            @case ('not_submitted') {
              You said it did not go through, so it does not count as applied.
            }
          }
        }
      </p>
      @if (a.note) {
        <p class="note">{{ a.note }}</p>
      }

      <section aria-labelledby="files-heading">
        <h2 id="files-heading">Files that went out</h2>
        @if (a.files.length) {
          <ul>
            @for (f of a.files; track f.id) {
              <li>
                @if (f.label) {
                  {{ f.label }}:
                }
                <a [href]="f.url">{{ f.fileName }}</a> ({{ size(f.bytes) }},
                @if (f.draft; as draft) {
                  the PDF the app kept of your
                  <a [routerLink]="['/drafts', draft.id, 'document']">{{
                    kindLabels[draft.kind]
                  }}</a
                  >)
                } @else {
                  uploaded as sent)
                }
                <span class="hash">SHA-256 {{ f.sha256 }}</span>
              </li>
            }
          </ul>
        } @else {
          <p>No files were recorded with it.</p>
        }
      </section>

      @if (a.facts.length) {
        <section aria-labelledby="facts-heading">
          <h2 id="facts-heading">Facts the files cite</h2>
          <p class="hint">As they were when it went out.</p>
          <ul>
            @for (f of a.facts; track f.factVersionId) {
              <li>
                <span class="kind">{{ factKindLabels[f.kind] }}, version {{ f.version }}:</span>
                {{ f.text }}
                @if (!f.stillCurrent) {
                  <span class="changed">This fact has changed or been withdrawn since.</span>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (a.form; as form) {
        <section aria-labelledby="form-heading">
          <h2 id="form-heading">The form as you approved it</h2>
          <p class="hint">Approved on {{ form.approvedAt | date: 'd MMM y, HH:mm' }}.</p>
          <ul>
            @for (field of form.fields; track $index) {
              <li>
                <span class="kind">{{ field.label }}:</span>
                {{ field.value.length ? field.value.join(', ') : 'empty' }}
              </li>
            }
          </ul>
          <a [href]="form.screenshotUrl" target="_blank" rel="noopener">
            <img class="screenshot" [src]="form.screenshotUrl" alt="The form you approved" />
          </a>
        </section>
      }

      @if (a.receipt; as receipt) {
        <section aria-labelledby="receipt-heading">
          <h2 id="receipt-heading">What the page showed after Submit</h2>
          <p class="hint">
            {{ receipt.checkedAt | date: 'd MMM y, HH:mm:ss'
            }}{{ receipt.confirmed ? ', Greenhouse’s confirmation page' : '' }}.
            {{ receipt.note }}
          </p>
          @if (receipt.pageText) {
            <pre class="text">{{ receipt.pageText }}</pre>
          }
          @if (receipt.screenshotUrl) {
            <a [href]="receipt.screenshotUrl" target="_blank" rel="noopener">
              <img class="screenshot" [src]="receipt.screenshotUrl" alt="The page after Submit" />
            </a>
          }
        </section>
      }

      <section aria-labelledby="match-heading">
        <h2 id="match-heading">The match</h2>
        @if (a.match; as m) {
          <p>
            Matched on {{ m.createdAt | date: 'd MMM y, HH:mm' }}: {{ verdictLabels[m.verdict] }}.
          </p>
          <ul>
            @for (r of m.requirements; track $index) {
              <li>
                <span class="kind">{{ r.kind === 'must' ? 'Must have' : 'Nice to have' }}:</span>
                {{ r.text }} — {{ outcomeLabels[r.outcome] }}.
                @if (r.note) {
                  <span class="hint">{{ r.note }}</span>
                }
              </li>
            }
          </ul>
        } @else {
          <p>The job’s text had not been matched with your facts.</p>
        }
      </section>

      <section aria-labelledby="job-heading">
        <h2 id="job-heading">The job text</h2>
        <p class="hint">
          {{ a.job.location || 'No location given' }} · read
          {{ a.job.capturedAt | date: 'd MMM y, HH:mm' }} from
          <a [href]="a.job.url" target="_blank" rel="noopener noreferrer">{{ a.job.url }}</a>
        </p>
        <details>
          <summary>Show the text</summary>
          <pre class="text">{{ a.job.text }}</pre>
        </details>
      </section>
    } @else if (data.isLoading()) {
      <p role="status">Loading the application…</p>
    } @else {
      <p class="error" role="alert">The application could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    ul {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 0.5rem;
      overflow-wrap: anywhere;
    }
    .hint,
    .hash,
    .changed {
      font-size: 0.9rem;
    }
    .hash,
    li .hint {
      display: block;
    }
    .kind {
      font-weight: 600;
    }
    .changed {
      display: block;
      font-style: italic;
    }
    .note {
      white-space: pre-wrap;
      border-left: 3px solid color-mix(in srgb, currentColor 40%, transparent);
      padding-left: 0.5rem;
    }
    .text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: inherit;
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
export class ApplicationPage {
  readonly id = input.required<string>();

  protected readonly data = httpResource<ApplicationRecord>(() => `/api/applications/${this.id()}`);
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly statusLabels = statusLabels;
  protected readonly methodLabels = methodLabels;
  protected readonly kindLabels = kindLabels;
  protected readonly factKindLabels = factKindLabels;
  protected readonly outcomeLabels = outcomeLabels;
  protected readonly verdictLabels = verdictLabels;

  protected size(bytes: number) {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
