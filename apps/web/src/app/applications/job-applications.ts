import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { JobApplications } from '@jsa/shared';
import { maxManualFiles, maxPdfBytes } from '@jsa/shared/limits';
import { errorMessage } from '../sources/sources-api';
import { ApplicationsApi } from './applications-api';
import { kindLabels, methodLabels, statusLabels } from './labels';

/** `date` as a datetime-local value, in the browser's time zone, to the minute. */
function localMinute(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The file's bytes in base64. */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The job's applications (T09), each linking to what it kept, and recording one the user sent
 * outside the app: when, where, and which files went out.
 */
@Component({
  selector: 'app-job-applications',
  imports: [DatePipe, FormField, FormRoot, RouterLink],
  template: `
    @if (state.hasValue()) {
      @let s = state.value();
      @if (s.applications.length) {
        <ul>
          @for (a of s.applications; track a.id) {
            <li>
              <a [routerLink]="['/applications', a.id]">{{ statusLabels[a.status] }}</a
              >, {{ methodLabels[a.method] }},
              {{ a.submittedAt ?? a.createdAt | date: 'd MMM y, HH:mm' }}
            </li>
          }
        </ul>
      } @else {
        <p>
          No application yet. Writing drafts, printing PDFs or opening the job’s page do not count.
        </p>
      }
      @if (s.cannotRecord; as reason) {
        <p class="hint">{{ reason }}</p>
      } @else if (!open()) {
        <button type="button" (click)="open.set(true)">I applied outside the app</button>
      } @else {
        <form [formRoot]="recordForm" aria-labelledby="record-heading">
          <h3 id="record-heading">Record an application you sent yourself</h3>
          <p class="hint">
            The record keeps this job’s text as the app has it now, its latest match, and the files
            you name below. It counts as applied at once, and not toward the runner’s limit.
          </p>
          <label>
            When you sent it
            <input type="datetime-local" [formField]="recordForm.sentAt" [max]="latest" />
          </label>
          @if (recordForm.sentAt().touched() && recordForm.sentAt().errors().length) {
            <p class="error" role="alert">{{ recordForm.sentAt().errors()[0].message }}</p>
          }
          <label>
            Where or how (optional)
            <input type="text" [formField]="recordForm.note" autocomplete="off" />
          </label>
          @if (recordForm.note().errors().length) {
            <p class="error" role="alert">{{ recordForm.note().errors()[0].message }}</p>
          }
          @if (s.pdfs.length) {
            <fieldset>
              <legend>PDFs the app kept that you sent</legend>
              @for (pdf of s.pdfs; track pdf.id) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="picked().includes(pdf.id)"
                    (change)="toggle(pdf.id)"
                  />
                  {{ pdf.fileName }} ({{ kindLabels[pdf.kind] }}, kept
                  {{ pdf.createdAt | date: 'd MMM y, HH:mm' }})
                </label>
              }
            </fieldset>
          }
          <label>
            The files you sent, as sent (PDF, up to {{ maxFiles }}, 2 MiB each)
            <input
              #files
              type="file"
              accept="application/pdf,.pdf"
              multiple
              (change)="choose(files)"
            />
          </label>
          @if (fileProblem()) {
            <p class="error" role="alert">{{ fileProblem() }}</p>
          }
          @if (failure()) {
            <p class="error" role="alert">{{ failure() }}</p>
          }
          <p class="actions">
            <button type="submit" [disabled]="recordForm().submitting() || !!fileProblem()">
              Record the application
            </button>
            <button type="button" (click)="open.set(false)">Cancel</button>
          </p>
        </form>
      }
    } @else if (state.isLoading()) {
      <p role="status">Loading…</p>
    } @else {
      <p class="error" role="alert">The applications could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 48rem;
      margin-top: 1rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    }
    h3 {
      margin: 0;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    label.check {
      display: block;
      overflow-wrap: anywhere;
    }
    fieldset {
      display: grid;
      gap: 0.25rem;
    }
    .hint {
      font-size: 0.9rem;
    }
    .actions button {
      margin-right: 0.5rem;
    }
    .error {
      margin: 0;
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class JobApplicationsView {
  private readonly api = inject(ApplicationsApi);

  readonly jobId = input.required<string>();
  /** An application was recorded. */
  readonly recorded = output<void>();

  protected readonly state = httpResource<JobApplications>(
    () => `/api/jobs/${this.jobId()}/applications`,
  );
  protected readonly loadError = computed(() => errorMessage(this.state.error()));

  protected readonly statusLabels = statusLabels;
  protected readonly methodLabels = methodLabels;
  protected readonly kindLabels = kindLabels;
  protected readonly maxFiles = maxManualFiles;
  /** The latest time the picker offers: a few minutes ahead, for a clock running behind. */
  protected readonly latest = localMinute(new Date(Date.now() + 5 * 60_000));

  protected readonly open = signal(false);
  protected readonly failure = signal('');
  protected readonly picked = signal<string[]>([]);
  private readonly files = signal<File[]>([]);

  protected readonly fileProblem = computed(() => {
    const files = this.files();
    if (files.length > maxManualFiles) return `Choose at most ${maxManualFiles} files.`;
    const big = files.find((f) => f.size > maxPdfBytes);
    if (big) return `${big.name} is larger than 2 MiB.`;
    return '';
  });

  private readonly model = signal({ sentAt: localMinute(new Date()), note: '' });

  protected readonly recordForm = form(
    this.model,
    (s) => {
      required(s.sentAt, { message: 'Give the date and time you sent it.' });
      validate(s.sentAt, ({ value }) =>
        value() && new Date(value()).getTime() > Date.now() + 5 * 60_000
          ? { kind: 'future', message: 'The time you sent it is in the future.' }
          : undefined,
      );
      maxLength(s.note, 1000, { message: 'Keep it to 1,000 characters.' });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          try {
            const { sentAt, note } = f().value();
            const files = await Promise.all(
              this.files().map(async (file) => ({
                fileName: file.name,
                body: await base64Of(file),
              })),
            );
            this.state.set(
              await this.api.record(this.jobId(), {
                submittedAt: new Date(sentAt).toISOString(),
                note,
                documentPdfIds: this.picked(),
                files,
              }),
            );
            this.open.set(false);
            this.recorded.emit();
          } catch (error) {
            // Shown apart from the form's errors, so the user can fix a file and send it again.
            this.failure.set(errorMessage(error));
            this.state.reload();
          }
          return undefined;
        },
      },
    },
  );

  /** The job's fill or form changed: whether an application can be recorded is asked again. */
  refresh() {
    this.state.reload();
  }

  protected toggle(id: string) {
    this.picked.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected choose(input: HTMLInputElement) {
    this.files.set([...(input.files ?? [])]);
  }
}
