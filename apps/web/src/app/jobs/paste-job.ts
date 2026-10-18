import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, pattern, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

const maxTextLength = 100_000;

@Component({
  selector: 'app-paste-job',
  imports: [FormField, FormRoot, RouterLink],
  template: `
    <p><a routerLink="/jobs">All jobs</a></p>
    <h1>Paste a job</h1>
    <p>
      For a job from any site, including sites the app does not read, such as LinkedIn. Copy the
      job’s link and its text from the page. The text is saved as it is and never changed.
    </p>
    <p class="hint">
      Saving does not call DeepSeek. You can read, summarise and match the saved job afterwards.
    </p>
    <form [formRoot]="pasteForm" [attr.aria-busy]="pasteForm().submitting()">
      <label>
        Job title
        <input
          [formField]="pasteForm.title"
          autocomplete="off"
          aria-describedby="paste-title-error"
        />
      </label>
      @if (showErrors(pasteForm.title)) {
        <p class="error" role="alert" id="paste-title-error">
          {{ pasteForm.title().errors()[0].message }}
        </p>
      }
      <label>
        Company (optional)
        <input
          [formField]="pasteForm.company"
          autocomplete="off"
          aria-describedby="paste-company-error"
        />
      </label>
      @if (showErrors(pasteForm.company)) {
        <p class="error" role="alert" id="paste-company-error">
          {{ pasteForm.company().errors()[0].message }}
        </p>
      }
      <label>
        Location (optional)
        <input
          [formField]="pasteForm.location"
          autocomplete="off"
          aria-describedby="paste-location-error"
        />
      </label>
      @if (showErrors(pasteForm.location)) {
        <p class="error" role="alert" id="paste-location-error">
          {{ pasteForm.location().errors()[0].message }}
        </p>
      }
      <label>
        Link to the job page
        <input
          type="url"
          [formField]="pasteForm.url"
          autocomplete="off"
          aria-describedby="paste-url-help paste-url-error"
        />
      </label>
      <p class="hint" id="paste-url-help">Use the HTTPS address of the original job page.</p>
      @if (showErrors(pasteForm.url)) {
        <p class="error" role="alert" id="paste-url-error">
          {{ pasteForm.url().errors()[0].message }}
        </p>
      }
      <label>
        Job text
        <textarea
          rows="16"
          [formField]="pasteForm.text"
          aria-describedby="paste-text-help paste-text-error"
        ></textarea>
      </label>
      <p class="hint" id="paste-text-help">
        The full original description, up to 100,000 characters.
      </p>
      @if (showErrors(pasteForm.text)) {
        <p class="error" role="alert" id="paste-text-error">
          {{ pasteForm.text().errors()[0].message }}
        </p>
      }
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
      <button type="submit" [disabled]="pasteForm().submitting()">
        {{ pasteForm().submitting() ? 'Saving…' : 'Save the job' }}
      </button>
      <p role="status">{{ pasteForm().submitting() ? 'Saving the job…' : '' }}</p>
    </form>
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 72ch;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    button {
      justify-self: start;
    }
    .error {
      margin: 0;
      color: var(--error-text);
    }
  `,
})
export class PasteJob {
  private readonly api = inject(JobsApi);
  protected readonly failure = signal('');
  private readonly router = inject(Router);

  private readonly model = signal({ title: '', company: '', location: '', url: '', text: '' });

  protected readonly pasteForm = form(
    this.model,
    (s) => {
      required(s.title, { message: 'Enter the job title.' });
      maxLength(s.title, 1000, { message: 'Keep the title under 1000 characters.' });
      maxLength(s.company, 1000, { message: 'Keep the company under 1000 characters.' });
      maxLength(s.location, 5000, { message: 'Keep the location under 5000 characters.' });
      required(s.url, { message: 'Enter the link to the job page.' });
      pattern(s.url, /^https:\/\/\S+$/, { message: 'Enter an https link.' });
      required(s.text, { message: 'Paste the job text.' });
      maxLength(s.text, maxTextLength, {
        message: `The job text can be at most ${maxTextLength.toLocaleString('en')} characters.`,
      });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          const { title, company, location, url, text } = f().value();
          try {
            const job = await this.api.paste({
              title: title.trim(),
              url: url.trim(),
              text,
              ...(company.trim() ? { company: company.trim() } : {}),
              ...(location.trim() ? { location: location.trim() } : {}),
            });
            await this.router.navigate(['/jobs', job.id]);
          } catch (error) {
            this.failure.set(errorMessage(error));
            return undefined;
          }
          return undefined;
        },
      },
    },
  );

  protected showErrors(field: typeof this.pasteForm.title) {
    return field().touched() && field().invalid();
  }
}
