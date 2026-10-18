import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApplicationRecord, FrozenMatch } from '@jsa/shared';
import { outcomeLabels } from '../jobs/job-summary';
import { errorMessage } from '../sources/sources-api';
import { factKindLabels, kindLabels, methodLabels, statusLabels, statusNotes } from './labels';

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
        <strong
          class="tag"
          [class.applied]="a.status === 'submitted'"
          [class.todo]="a.status === 'to_verify'"
          >{{ statusLabels[a.status] }}</strong
        >
        · {{ methodLabels[a.method] }}.
      </p>
      <p>
        @if (a.method === 'manual') {
          You sent it on {{ a.submittedAt | date: 'd MMM y, HH:mm' }} and recorded it on
          {{ a.createdAt | date: 'd MMM y, HH:mm' }}.
        } @else {
          The runner pressed Submit on {{ a.createdAt | date: 'd MMM y, HH:mm' }}.
        }
      </p>
      <p [class.notice]="a.status === 'to_verify'">{{ statusNotes[a.status] }}</p>
      @if (a.status === 'to_verify') {
        <p class="actions">
          <a class="button primary" [routerLink]="['/jobs', a.jobId]" fragment="application-heading"
            >Verify on the job page</a
          >
        </p>
      }
      <p class="hint">
        This record keeps the files, fact versions, approved fields and job text as they were then.
        Later changes do not replace this history.
      </p>
      @if (a.note) {
        <p class="note">{{ a.note }}</p>
      }
      @if (a.status === 'submitted') {
        <p class="actions">
          <a class="button primary" [routerLink]="['/applications', a.id, 'interview']"
            >Prepare for an interview</a
          >
        </p>
      }

      <section aria-labelledby="files-heading">
        <h2 id="files-heading">
          {{ a.status === 'submitted' ? 'Files that went out' : 'Files recorded for this attempt' }}
        </h2>
        <p class="hint">
          Download the frozen PDF here. A current document may have changed or become outdated; it
          does not replace the file recorded with this application.
        </p>
        @if (a.files.length) {
          <ul>
            @for (f of a.files; track f.id) {
              <li>
                @if (f.label) {
                  {{ f.label }}:
                }
                <a [href]="f.url">{{ f.fileName }}</a> ({{ size(f.bytes) }})
                @if (f.draft; as draft) {
                  <p class="hint">PDF kept by the app from your {{ kindLabels[draft.kind] }}.</p>
                  <p>
                    <a [routerLink]="['/drafts', draft.id, 'document']"
                      >Current {{ kindLabels[draft.kind] }} document (may have changed)</a
                    >
                  </p>
                } @else {
                  <p class="hint">External PDF uploaded as sent.</p>
                }
                <span class="hash">SHA-256 {{ f.sha256 }}</span>
              </li>
            }
          </ul>
        } @else {
          <p>No files were recorded with it.</p>
        }
      </section>

      <section aria-labelledby="facts-heading">
        <h2 id="facts-heading">Facts the files cite</h2>
        <p class="hint">The historical versions recorded with this application.</p>
        <ul>
          @for (f of a.facts; track f.factVersionId) {
            <li>
              <span class="kind">{{ factKindLabels[f.kind] }}, version {{ f.version }}:</span>
              {{ f.text }}
              @if (!f.stillCurrent) {
                <span class="changed notice"
                  >This fact has changed or been withdrawn since. Its historical text is kept
                  here.</span
                >
              }
            </li>
          } @empty {
            <li>
              No fact versions were recorded. External PDF uploads do not add fact references.
            </li>
          }
        </ul>
      </section>

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
          <details>
            <summary>Approved form screenshot</summary>
            <a [href]="form.screenshotUrl" target="_blank" rel="noopener">
              <img class="screenshot" [src]="form.screenshotUrl" alt="The form you approved" />
            </a>
          </details>
        </section>
      } @else {
        <section aria-labelledby="form-heading">
          <h2 id="form-heading">Approval record</h2>
          <p>
            {{
              a.method === 'manual'
                ? 'Sent outside the app. No runner approval exists.'
                : 'No approved form was recorded.'
            }}
          </p>
        </section>
      }

      <section aria-labelledby="receipt-heading">
        <h2 id="receipt-heading">What the page showed after Submit</h2>
        @if (a.receipt; as receipt) {
          <p class="hint">
            {{ receipt.checkedAt | date: 'd MMM y, HH:mm:ss'
            }}{{
              receipt.confirmed ? ', Greenhouse’s confirmation page' : ', no confirmation observed'
            }}.
            {{ receipt.note }}
          </p>
          @if (receipt.pageText) {
            <pre class="text">{{ receipt.pageText }}</pre>
          }
          @if (receipt.screenshotUrl) {
            <details>
              <summary>Page screenshot after Submit</summary>
              <a [href]="receipt.screenshotUrl" target="_blank" rel="noopener">
                <img class="screenshot" [src]="receipt.screenshotUrl" alt="The page after Submit" />
              </a>
            </details>
          }
        } @else {
          <p>
            {{
              a.method === 'manual'
                ? 'No runner receipt exists for an application sent outside the app.'
                : 'No receipt was recorded. This alone does not confirm whether the application went through.'
            }}
          </p>
        }
      </section>

      <section aria-labelledby="match-heading">
        <h2 id="match-heading">The frozen match</h2>
        @if (a.match; as m) {
          <details>
            <summary>Read the match recorded with this application</summary>
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
          </details>
        } @else {
          <p>The job’s text had not been matched with your facts.</p>
        }
      </section>

      <section aria-labelledby="job-heading">
        <h2 id="job-heading">The frozen job text</h2>
        <p class="hint">
          {{ a.job.location || 'No location given' }} · read
          {{ a.job.capturedAt | date: 'd MMM y, HH:mm' }} from
          <a [href]="a.job.url" target="_blank" rel="noopener noreferrer">{{ a.job.url }}</a>
        </p>
        <details>
          <summary>Read the frozen original</summary>
          <pre class="text">{{ a.job.text }}</pre>
        </details>
      </section>
    } @else if (data.isLoading()) {
      <h1>Application</h1>
      <p role="status">Loading the application…</p>
    } @else {
      <h1>Application</h1>
      @if (notFound()) {
        <p role="alert">
          This application could not be found. Return to all applications to choose a record.
        </p>
      } @else {
        <p class="error" role="alert">The application could not be loaded. {{ loadError() }}</p>
        <button type="button" (click)="data.reload()">Try again</button>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 72ch;
    }
    section {
      margin-top: 32px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
    }
    ul {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 16px;
      overflow-wrap: anywhere;
    }
    .hint,
    .hash,
    .changed {
      font-size: 14px;
    }
    .hash,
    li .hint {
      display: block;
      color: var(--muted);
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
      border-left: 1px solid var(--line);
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
      border: 1px solid var(--line);
    }
  `,
})
export class ApplicationPage {
  readonly id = input.required<string>();

  protected readonly data = httpResource<ApplicationRecord>(() => `/api/applications/${this.id()}`);
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly notFound = computed(() => {
    const error = this.data.error();
    return error instanceof HttpErrorResponse && error.status === 404;
  });

  protected readonly statusLabels = statusLabels;
  protected readonly methodLabels = methodLabels;
  protected readonly statusNotes = statusNotes;
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
