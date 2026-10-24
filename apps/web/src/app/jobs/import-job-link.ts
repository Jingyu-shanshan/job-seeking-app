import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  form,
  maxLength,
  pattern,
  required,
  validate,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import type { JobDetail } from '@jsa/shared';
import { jobLinkImportProblem } from '@jsa/shared/job-link-import';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

@Component({
  selector: 'app-import-job-link',
  imports: [FormField, FormRoot, RouterLink],
  template: `
    <section aria-labelledby="link-import-title">
      <h2 id="link-import-title">Have a job link?</h2>
      <p>
        Import a public company job page, Greenhouse or Ashby link, then analyse its requirements.
      </p>
      <form [formRoot]="linkForm" [attr.aria-busy]="linkForm().submitting()">
        <fieldset class="form-fields" [disabled]="linkForm().submitting()">
          <label>
            <span id="job-reading-method-label">Reading method</span>
            <select
              [formField]="linkForm.method"
              aria-labelledby="job-reading-method-label"
              aria-describedby="reading-method-help"
            >
              <option value="direct">Official API / public company page</option>
              <option value="deepseek_fetch" disabled>DeepSeek Fetch — unavailable</option>
            </select>
          </label>
          <p id="reading-method-help" class="hint">
            DeepSeek Fetch import is unavailable because the final destination cannot be verified.
            No paid Fetch request is made here. If this method fails, paste the text or save the
            page in the desktop app.
          </p>
          <label>
            Job link
            <input
              type="url"
              [formField]="linkForm.url"
              autocomplete="off"
              placeholder="https://job-boards.greenhouse.io/company/jobs/123"
              aria-describedby="job-link-help job-link-error"
            />
          </label>
          @if (siteProblem() || (linkForm.url().touched() && linkForm.url().invalid())) {
            <p role="alert" id="job-link-error">
              {{ siteProblem() ?? linkForm.url().errors()[0].message }}
            </p>
          }
          <p class="hint" id="job-link-help">
            This saves the original job text and makes one DeepSeek request to analyse it. Only the
            job text is sent; your facts and contact details are not included. The call’s recorded
            cost appears on the job page.
          </p>
          @if (linkForm.method().invalid()) {
            <p role="alert">{{ linkForm.method().errors()[0].message }}</p>
          }
          <button
            type="submit"
            class="primary"
            [disabled]="!!siteProblem() || linkForm.method().invalid()"
          >
            {{
              linkForm().submitting()
                ? phase()
                : imported()
                  ? 'Retry analysis'
                  : 'Import and analyse'
            }}
          </button>
        </fieldset>
      </form>
      @if (linkForm().submitting()) {
        <p role="status">{{ phase() }}</p>
      }
      @if (failure()) {
        <p role="alert">{{ failure() }}</p>
      }
      @if (imported(); as job) {
        <p>
          Your job is saved. <a [routerLink]="['/jobs', job.id]">Open {{ job.title }}</a> to review
          its original text or continue there.
        </p>
      }
      <details>
        <summary>Page needs a login, or cannot be imported?</summary>
        <p>
          Open the job in the desktop app’s browser and choose Save this job, then analyse it on its
          job page. You can also paste the text below. Company pages that require JavaScript, a
          login or a CAPTCHA may need this approach. LinkedIn, Duunitori and Jobly links are not
          fetched here.
        </p>
      </details>
    </section>
  `,
  styles: `
    section {
      margin: 24px 0 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin-top: 0;
    }
    form {
      margin-bottom: 16px;
    }
  `,
})
export class ImportJobLink {
  private readonly api = inject(JobsApi);
  private readonly router = inject(Router);
  private readonly model = signal<{ url: string; method: 'direct' | 'deepseek_fetch' }>({
    url: '',
    method: 'direct',
  });
  protected readonly imported = linkedSignal({
    source: () => `${this.model().method}/${this.model().url}`,
    computation: (): JobDetail | null => null,
  });
  protected readonly siteProblem = computed(() => jobLinkImportProblem(this.model().url));
  protected readonly failure = linkedSignal({
    source: () => `${this.model().method}/${this.model().url}`,
    computation: () => '',
  });
  protected readonly phase = signal('Reading the job…');
  protected readonly linkForm = form(
    this.model,
    (s) => {
      validate(s.method, ({ value }) =>
        value() === 'direct'
          ? undefined
          : {
              kind: 'unavailable',
              message:
                'DeepSeek Fetch import is disabled. Choose the official API / public page method, or paste the text.',
            },
      );
      required(s.url, { message: 'Paste a job link.' });
      pattern(s.url, /^https:\/\/\S+$/, { message: 'Enter an https link.' });
      maxLength(s.url, 2000, { message: 'Keep the link under 2000 characters.' });
      validate(s.url, ({ value }) => {
        const message = jobLinkImportProblem(value());
        return message ? { kind: 'site', message } : undefined;
      });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          try {
            let job = this.imported();
            if (!job) {
              this.phase.set('Reading the job…');
              job = await this.api.importLink(f().value().url.trim(), f().value().method);
              this.imported.set(job);
            }
            if (!job.snapshot) throw new Error('The imported job has no original text.');
            if (!job.snapshot.summary) {
              this.phase.set('Analysing the job with DeepSeek…');
              job = await this.api.summarise(job.snapshot.id);
              this.imported.set(job);
            }
            await this.router.navigate(['/jobs', job.id]);
          } catch (error) {
            this.failure.set(errorMessage(error));
          }
          return undefined;
        },
      },
    },
  );
}
