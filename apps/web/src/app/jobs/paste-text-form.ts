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
    <form [formRoot]="textForm">
      @if (needsLink()) {
        <label>
          Link to the job page
          <input type="url" [formField]="textForm.url" autocomplete="off" />
        </label>
        @if (textForm.url().touched() && textForm.url().errors().length) {
          <p class="error" role="alert">{{ textForm.url().errors()[0].message }}</p>
        }
      }
      <label>
        Job text
        <textarea rows="10" [formField]="textForm.text"></textarea>
      </label>
      @if (textForm.text().touched() && textForm.text().errors().length) {
        <p class="error" role="alert">{{ textForm.text().errors()[0].message }}</p>
      }
      @for (error of textForm().errors(); track $index) {
        <p class="error" role="alert">{{ error.message }}</p>
      }
      <button type="submit" [disabled]="textForm().submitting()">Save the text</button>
    </form>
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
    button {
      justify-self: start;
    }
    .error {
      margin: 0;
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class PasteTextForm {
  private readonly api = inject(JobsApi);

  readonly jobId = input.required<string>();
  /** True when the app has no address for the job, so the text needs its link. */
  readonly needsLink = input(false);
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
            return { kind: 'server', message: errorMessage(error) };
          }
          return undefined;
        },
      },
    },
  );
}
