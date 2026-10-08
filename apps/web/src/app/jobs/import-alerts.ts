import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type {
  AlertEmailsResponse,
  AlertJob,
  ImportAlertEmailResponse,
  SourcesResponse,
} from '@jsa/shared';
import { maxAlertEmailLength } from '@jsa/shared/limits';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

/** What happened to one pasted or uploaded email. */
interface Outcome {
  /** The file's name, or "Pasted email". */
  label: string;
  result?: ImportAlertEmailResponse;
  error?: string;
}

const tooLong = `An email’s source can be at most ${maxAlertEmailLength.toLocaleString('en')} characters.`;

/** Importing job-alert emails (T20): paste an email's source or upload .eml files. */
@Component({
  selector: 'app-import-alerts',
  imports: [DatePipe, FormField, FormRoot, RouterLink],
  template: `
    <p><a routerLink="/jobs">All jobs</a></p>
    <h1>Import job-alert emails</h1>
    <p>
      For sites the app does not read itself, such as LinkedIn and Duunitori: set up job alerts on
      the site, then import the emails here. The app reads the jobs an email lists, without opening
      its links or visiting the site. A job the app already has, at the same address or with the
      same company and title on one of your job boards or in another alert, is not added again.
      Which senders count is on the <a routerLink="/sources">Sources</a> page.
    </p>
    <details>
      <summary>How to get an email’s source</summary>
      <ul>
        <li>
          Gmail: open the email, then ⋮ → Show original → Copy to clipboard, or ⋮ → Download message
          for an .eml file.
        </li>
        <li>Outlook: … → View → View message source, or save the email as an .eml file.</li>
        <li>Apple Mail: View → Message → Raw Source, or drag the email to a folder.</li>
      </ul>
      <p>
        Paste all of it, headers included. The email is not kept, only what identifies it and the
        jobs read from it.
      </p>
    </details>

    <form [formRoot]="pasteForm">
      <label>
        Email source
        <textarea rows="10" spellcheck="false" [formField]="pasteForm.message"></textarea>
      </label>
      @if (pasteForm.message().touched() && pasteForm.message().invalid()) {
        <p class="error" role="alert">{{ pasteForm.message().errors()[0].message }}</p>
      }
      <button type="submit" [disabled]="busy()">Import</button>
    </form>
    <p>
      <label>
        Or upload .eml files
        <input
          #files
          type="file"
          accept=".eml,message/rfc822"
          multiple
          [disabled]="busy()"
          (change)="upload(files)"
        />
      </label>
    </p>
    <p role="status">
      @if (busy()) {
        Importing…
      }
    </p>

    @if (outcomes().length) {
      <section aria-labelledby="results-heading">
        <h2 id="results-heading">Imported now</h2>
        <ul class="outcomes">
          @for (outcome of outcomes(); track $index) {
            <li>
              <strong>{{ outcome.label }}</strong>
              @if (outcome.error) {
                <p class="error" role="alert">Not imported: {{ outcome.error }}</p>
              } @else if (outcome.result; as r) {
                <p>
                  {{ sourceName(r.catalogId) }} · {{ r.subject || 'No subject' }}
                  @if (r.sentAt) {
                    · sent {{ r.sentAt | date: 'd MMM y' }}
                  }
                </p>
                @if (!r.imported) {
                  <p class="error">Not imported: {{ r.reason }}</p>
                } @else {
                  @if (summary(r); as line) {
                    <p>{{ line }}</p>
                  }
                  @if (r.reason) {
                    <p class="warning">{{ r.reason }}</p>
                  }
                  <ul>
                    @for (job of r.jobs; track job.jobId + job.url) {
                      <li>
                        <a [routerLink]="['/jobs', job.jobId]">{{ job.title }}</a>
                        · {{ job.company ?? 'Company not given' }}
                        @if (job.location) {
                          · {{ job.location }}
                        }
                        <span class="note">{{ jobNote(job) }}</span>
                      </li>
                    }
                  </ul>
                }
              }
            </li>
          }
        </ul>
      </section>
    }

    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading">Imported before</h2>
      @if (recent.hasValue()) {
        @if (recent.value().emails.length) {
          <ul>
            @for (email of recent.value().emails; track email.id) {
              <li>
                {{ sourceName(email.catalogId) }} · {{ email.subject || 'No subject' }} ·
                {{ email.jobs === 1 ? '1 job' : email.jobs + ' jobs' }}
                @if (email.sentAt) {
                  · sent {{ email.sentAt | date: 'd MMM y' }}
                }
              </li>
            }
          </ul>
        } @else {
          <p>No email imported yet.</p>
        }
      } @else if (recent.error()) {
        <p class="error" role="alert">The imported emails could not be loaded.</p>
      }
    </section>
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 48rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    textarea {
      font-family: monospace;
    }
    button {
      justify-self: start;
    }
    .outcomes > li {
      margin-bottom: 1rem;
    }
    .outcomes p {
      margin: 0.25rem 0;
    }
    .note {
      display: block;
      font-size: 0.9rem;
      font-style: italic;
    }
    li {
      overflow-wrap: anywhere;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
    .warning {
      color: light-dark(#8a4b00, #ffc46b);
    }
  `,
})
export class ImportAlerts {
  private readonly api = inject(JobsApi);

  protected readonly recent = httpResource<AlertEmailsResponse>(() => '/api/alert-emails');
  private readonly sources = httpResource<SourcesResponse>(() => '/api/sources');
  private readonly names = computed(
    () => new Map((this.sources.value()?.catalog ?? []).map((entry) => [entry.id, entry.name])),
  );

  protected readonly outcomes = signal<Outcome[]>([]);
  protected readonly busy = signal(false);

  private readonly model = signal({ message: '' });

  protected readonly pasteForm = form(
    this.model,
    (s) => {
      required(s.message, { message: 'Paste an email’s source.' });
      maxLength(s.message, maxAlertEmailLength, { message: tooLong });
    },
    {
      submission: {
        action: async (f) => {
          const ok = await this.run([
            { label: 'Pasted email', read: async () => f.message().value() },
          ]);
          if (ok) f().reset({ message: '' });
          return undefined;
        },
      },
    },
  );

  protected sourceName(catalogId: string | null) {
    return catalogId ? (this.names().get(catalogId) ?? catalogId) : 'Unknown sender';
  }

  protected summary(result: ImportAlertEmailResponse) {
    const jobs = result.jobs.length;
    const added = result.jobs.filter((job) => job.match === 'new').length;
    const read = jobs === 1 ? '1 job read' : `${jobs} jobs read`;
    // With no job read, the reason says why.
    const parts = jobs ? [`${read}: ${added} new, ${jobs - added} the app had already.`] : [];
    if (result.unreadable) {
      parts.push(
        `${result.unreadable === 1 ? '1 job' : `${result.unreadable} jobs`} in it could not be read.`,
      );
    }
    if (result.again) parts.push('This email was imported before.');
    return parts.join(' ');
  }

  protected jobNote(job: AlertJob) {
    const known = {
      new: 'New.',
      address: 'The app had this job already.',
      same_job: 'The same company and title as a job the app had.',
    }[job.match];
    const text = job.onBoard
      ? 'Your job board lists it, so its text can be read there.'
      : job.url
        ? 'Needs the job text: paste it, or save its page in the desktop app.'
        : 'The email has no link the app can read: open the job from the email, then paste its text or save its page.';
    return `${known} ${text}`;
  }

  protected async upload(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    await this.run(
      files.map((file) => ({
        label: file.name,
        read: async () => {
          if (file.size > maxAlertEmailLength * 4) throw new Error(tooLong);
          return file.text();
        },
      })),
    );
  }

  /** Imports the emails one after another; true when all of them reached the server. */
  private async run(emails: { label: string; read: () => Promise<string> }[]) {
    if (!emails.length) return false;
    this.busy.set(true);
    let ok = true;
    const outcomes: Outcome[] = [];
    try {
      for (const { label, read } of emails) {
        try {
          const message = await read();
          if (message.length > maxAlertEmailLength) throw new Error(tooLong);
          outcomes.push({ label, result: await this.api.importAlertEmail(message) });
        } catch (error) {
          ok = false;
          outcomes.push({
            label,
            error:
              error instanceof Error && error.message === tooLong ? tooLong : errorMessage(error),
          });
        }
        this.outcomes.set([...outcomes]);
      }
    } finally {
      this.busy.set(false);
      this.recent.reload();
    }
    return ok;
  }
}
