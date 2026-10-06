import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { Draft, DraftStatement, EditStatementRequest } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { DraftsApi } from './drafts-api';
import { StatementCheck } from './statement-check';

/**
 * One statement of a draft under review (T08): its text, what its checks found, and the user's
 * changes. The user's text is checked like DeepSeek's; DeepSeek's text is kept and can come back.
 */
@Component({
  selector: 'app-statement-review',
  imports: [StatementCheck],
  template: `
    @let s = statement();
    <span class="text" [id]="'s-' + s.id" [class.out]="!s.inDocument" [class.entry]="entry()">
      {{ s.text }}
    </span>
    <app-statement-check [statement]="s" />
    @if (editing()) {
      <label>
        Your text
        <textarea rows="3" [value]="text()" (input)="text.set(area.value)" #area></textarea>
      </label>
      <p class="hint">
        Checked like DeepSeek’s text, against the same facts or quote, so it cannot add what they do
        not say. DeepSeek’s text is kept.
      </p>
      <button
        type="button"
        [disabled]="busy()"
        (click)="save({ text: text(), included: s.included })"
      >
        Save
      </button>
      <button type="button" [disabled]="busy()" (click)="editing.set(false)">Cancel</button>
    } @else {
      <div class="actions">
        <button
          type="button"
          [disabled]="busy()"
          [attr.aria-describedby]="'s-' + s.id"
          (click)="editing.set(true)"
        >
          Edit
        </button>
        <!-- Only a statement that passes its checks can be in the document. -->
        @if (!s.problems.length) {
          <button
            type="button"
            [disabled]="busy()"
            [attr.aria-describedby]="'s-' + s.id"
            (click)="save({ text: s.text, included: !s.included })"
          >
            {{ s.included ? 'Leave out' : 'Put back' }}
          </button>
        }
        @if (s.edited) {
          <button
            type="button"
            [disabled]="busy()"
            [attr.aria-describedby]="'s-' + s.id"
            (click)="save({ text: s.modelText, included: s.included })"
          >
            Use DeepSeek’s text
          </button>
        }
      </div>
    }
    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .entry {
      font-weight: 600;
    }
    .out {
      text-decoration: line-through;
      opacity: 0.75;
    }
    label {
      display: block;
      font-size: 0.9rem;
    }
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font: inherit;
    }
    .actions {
      margin-bottom: 0.5rem;
    }
    button {
      margin-right: 0.5rem;
    }
    .hint {
      font-size: 0.9rem;
      margin: 0.25rem 0;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class StatementReview {
  private readonly api = inject(DraftsApi);

  readonly draftId = input.required<string>();
  readonly statement = input.required<DraftStatement>();
  /** A resume entry's title line, shown in bold. */
  readonly entry = input(false);
  /** The draft, checked again after a change. */
  readonly changed = output<Draft>();

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly text = linkedSignal(() => this.statement().text);

  protected async save(change: EditStatementRequest) {
    this.busy.set(true);
    this.failure.set('');
    try {
      this.changed.emit(await this.api.editStatement(this.draftId(), this.statement().id, change));
      this.editing.set(false);
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
