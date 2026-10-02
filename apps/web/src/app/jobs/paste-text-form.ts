import { Component, inject, input, output, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import type { JobDetail } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

const maxTextLength = 100_000;

/** Job text the user pastes for a job the app has no text for. */
@Component({
  selector: 'app-paste-text-form',
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="textForm">
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
  readonly saved = output<JobDetail>();

  private readonly model = signal({ text: '' });

  protected readonly textForm = form(
    this.model,
    (s) => {
      required(s.text, { message: 'Paste the job text.' });
      maxLength(s.text, maxTextLength, {
        message: `The job text can be at most ${maxTextLength.toLocaleString('en')} characters.`,
      });
    },
    {
      submission: {
        action: async (f) => {
          try {
            this.saved.emit(await this.api.pasteText(this.jobId(), f().value().text));
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          return undefined;
        },
      },
    },
  );
}
