import { Component, inject, input, linkedSignal, output } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import type { JobDetail, Requirement, RequirementKind } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

/** 添加一条要求，或更正 `replaces` 那一条（服务端同时移除旧的）。引用同样要能在原文里找到。 */
@Component({
  selector: 'app-requirement-form',
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="requirementForm">
      <label>
        Requirement
        <input [formField]="requirementForm.text" autocomplete="off" />
      </label>
      <label>
        Kind
        <select [formField]="requirementForm.kind">
          <option value="must">Must have</option>
          <option value="nice">Nice to have</option>
        </select>
      </label>
      <label>
        Quote from the job text
        <textarea rows="2" [formField]="requirementForm.quote"></textarea>
      </label>
      <p class="hint">
        Copy the words from the job text. A requirement whose quote is not in the job text stays to
        confirm and is not counted as what the job asks.
      </p>
      @if (requirementForm.text().touched() && requirementForm.text().errors().length) {
        <p class="error" role="alert">{{ requirementForm.text().errors()[0].message }}</p>
      }
      @if (requirementForm.quote().errors().length) {
        <p class="error" role="alert">{{ requirementForm.quote().errors()[0].message }}</p>
      }
      @for (error of requirementForm().errors(); track $index) {
        <p class="error" role="alert">{{ error.message }}</p>
      }
      <button type="submit" [disabled]="requirementForm().submitting()">Save</button>
      <button type="button" (click)="cancelled.emit()">Cancel</button>
    </form>
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 40rem;
      margin: 0.5rem 0 1rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    button {
      justify-self: start;
    }
    .hint {
      margin: 0;
      font-size: 0.9rem;
    }
    .error {
      margin: 0;
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class RequirementForm {
  private readonly api = inject(JobsApi);

  readonly snapshotId = input.required<string>();
  /** 更正时是被更正的那一条；添加时不给。 */
  readonly replaces = input<Requirement>();
  readonly saved = output<JobDetail>();
  readonly cancelled = output();

  private readonly model = linkedSignal<{ text: string; kind: RequirementKind; quote: string }>(
    () => {
      const old = this.replaces();
      return { text: old?.text ?? '', kind: old?.kind ?? 'must', quote: old?.quote ?? '' };
    },
  );

  protected readonly requirementForm = form(
    this.model,
    (s) => {
      required(s.text, { message: 'Say what the job asks for.' });
      maxLength(s.text, 1000, { message: 'Keep the requirement under 1000 characters.' });
      maxLength(s.quote, 1000, { message: 'Keep the quote under 1000 characters.' });
    },
    {
      submission: {
        action: async (f) => {
          const { text, kind, quote } = f().value();
          try {
            const detail = await this.api.addRequirement(this.snapshotId(), {
              text: text.trim(),
              kind,
              quote: quote.trim(),
              ...(this.replaces() ? { replaces: this.replaces()!.id } : {}),
            });
            this.saved.emit(detail);
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          return undefined;
        },
      },
    },
  );
}
