import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required, validate } from '@angular/forms/signals';
import type { JobDetail } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

@Component({
  selector: 'app-job-details-form',
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="detailsForm" [attr.aria-busy]="detailsForm().submitting()">
      <fieldset class="form-fields" [disabled]="detailsForm().submitting()">
        <legend>Edit job details</legend>
        <label>Job title <input [formField]="detailsForm.title" /></label>
        <label>Company (optional) <input [formField]="detailsForm.company" /></label>
        <label>Location (optional) <input [formField]="detailsForm.location" /></label>
        <label>Job link (optional) <input type="url" [formField]="detailsForm.url" /></label>
        @for (
          field of [detailsForm.title, detailsForm.company, detailsForm.location, detailsForm.url];
          track field
        ) {
          @if (field().touched() && field().invalid()) {
            <p role="alert">{{ field().errors()[0].message }}</p>
          }
        }
        <p class="hint">
          These details do not change the original job text or previous applications.
        </p>
        @if (failure()) {
          <p role="alert">{{ failure() }}</p>
        }
        <button type="submit">{{ detailsForm().submitting() ? 'Saving…' : 'Save details' }}</button>
        <button type="button" (click)="cancelled.emit()">Cancel</button>
      </fieldset>
    </form>
  `,
})
export class JobDetailsForm {
  private readonly api = inject(JobsApi);
  readonly job = input.required<JobDetail>();
  readonly saved = output<JobDetail>();
  readonly cancelled = output<void>();
  protected readonly failure = signal('');
  private readonly model = linkedSignal(() => ({
    title: this.job().title,
    company: this.job().company ?? '',
    location: this.job().location,
    url: this.job().url ?? '',
  }));
  protected readonly detailsForm = form(
    this.model,
    (s) => {
      required(s.title, { message: 'Enter the job title.' });
      validate(s.title, ({ value }) =>
        value().trim() ? undefined : { kind: 'required', message: 'Enter the job title.' },
      );
      maxLength(s.title, 1000, { message: 'Keep the title under 1000 characters.' });
      maxLength(s.company, 1000, { message: 'Keep the company under 1000 characters.' });
      maxLength(s.location, 5000, { message: 'Keep the location under 5000 characters.' });
      maxLength(s.url, 2000, { message: 'Keep the link under 2000 characters.' });
      validate(s.url, ({ value }) => {
        const url = value().trim();
        if (!url) return undefined;
        if (URL.canParse(url)) {
          const parsed = new URL(url);
          if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
            return undefined;
        }
        return { kind: 'url', message: 'Enter an https link without a user name or password.' };
      });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          const { title, company, location, url } = f().value();
          try {
            this.saved.emit(
              await this.api.updateDetails(this.job().id, {
                title: title.trim(),
                company: company.trim() || null,
                location: location.trim(),
                url: url.trim() || null,
              }),
            );
          } catch (error) {
            this.failure.set(errorMessage(error));
          }
          return undefined;
        },
      },
    },
  );
}
