import { Component, inject, input, output, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  applyWhen,
  form,
  maxLength,
  pattern,
  required,
} from '@angular/forms/signals';
import type { JobDetail } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

const maxTextLength = 100_000;

/**
 * Job text the user pastes for a job the app has no text for, with the link to the job page when
 * the app has none.
 */
@Component({
  selector: 'app-paste-text-form',
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="textForm" [attr.aria-busy]="textForm().submitting()">
      @if (needsLink()) {
        <label>
          Link to the job page
          <input
            type="url"
            [formField]="textForm.url"
            autocomplete="off"
            aria-describedby="text-link-help text-link-error"
          />
        </label>
        <p class="hint" id="text-link-help">Use the HTTPS address of the original job page.</p>
        @if (textForm.url().touched() && textForm.url().errors().length) {
          <p class="error" role="alert" id="text-link-error">
            {{ textForm.url().errors()[0].message }}
          </p>
        }
      }
      <label>
        Job text
        <textarea
          rows="10"
          [formField]="textForm.text"
          aria-describedby="text-help text-error"
        ></textarea>
      </label>
      <p class="hint" id="text-help">
        Paste the full original description, up to 100,000 characters. Saving does not call
        DeepSeek.
      </p>
      @if (textForm.text().touched() && textForm.text().errors().length) {
        <p class="error" role="alert" id="text-error">{{ textForm.text().errors()[0].message }}</p>
      }
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
      <button type="submit" [disabled]="busy() || textForm().submitting()">
        {{ textForm().submitting() ? 'Saving…' : 'Save the text' }}
      </button>
      <p role="status">{{ textForm().submitting() ? 'Saving the original text…' : '' }}</p>
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
export class PasteTextForm {
  private readonly api = inject(JobsApi);
  protected readonly failure = signal('');

  readonly jobId = input.required<string>();
  /** True when the app has no address for the job, so the text needs its link. */
  readonly needsLink = input(false);
  readonly busy = input(false);
  readonly saved = output<JobDetail>();

  private readonly model = signal({ text: '', url: '' });

  protected readonly textForm = form(
    this.model,
    (s) => {
      applyWhen(
        s.url,
        () => this.needsLink(),
        (url) => {
          required(url, { message: 'Enter the link to the job page.' });
          pattern(url, /^https:\/\/\S+$/, { message: 'Enter an https link.' });
        },
      );
      required(s.text, { message: 'Paste the job text.' });
      maxLength(s.text, maxTextLength, {
        message: `The job text can be at most ${maxTextLength.toLocaleString('en')} characters.`,
      });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          try {
            const { text, url } = f().value();
            this.saved.emit(
              await this.api.pasteText(
                this.jobId(),
                text,
                this.needsLink() ? url.trim() : undefined,
              ),
            );
          } catch (error) {
            this.failure.set(errorMessage(error));
            return undefined;
          }
          return undefined;
        },
      },
    },
  );
}
