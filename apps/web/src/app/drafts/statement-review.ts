import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
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
    <div class="wording">
      <p class="hint">{{ s.edited ? 'Your wording' : 'DeepSeek wording' }}</p>
      <span class="text" [id]="'s-' + s.id" [class.out]="!s.inDocument" [class.entry]="entry()">
        {{ s.text }}
      </span>
      @if (editing()) {
        <label>
          Your text
          <textarea
            rows="3"
            maxlength="2000"
            [disabled]="busy()"
            [value]="text()"
            (input)="text.set(area.value)"
            #area
          ></textarea>
        </label>
        <p class="hint">
          Checked like DeepSeek’s text, against the same facts or quote. Checks do not judge
          meaning; read the evidence yourself. DeepSeek’s text is kept. At most 2,000 characters.
        </p>
        <button
          type="button"
          [disabled]="busy() || !text().trim() || text().length > 2000"
          (click)="save({ text: text(), included: s.included })"
        >
          Save
        </button>
        <button type="button" [disabled]="busy()" (click)="setEditing(false)">Cancel</button>
      } @else {
        <div class="actions">
          <button
            #editButton
            type="button"
            [disabled]="busy()"
            [attr.aria-describedby]="'s-' + s.id"
            (click)="setEditing(true)"
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
      <p role="status">{{ busy() ? 'Saving and checking this statement…' : status() }}</p>
    </div>
    <app-statement-check [statement]="s" />
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 24px;
      padding: 20px 0;
      border-bottom: 1px solid var(--line);
    }
    .wording {
      min-width: 0;
    }
    .text {
      display: block;
      white-space: pre-wrap;
      line-height: 1.7;
    }
    .entry {
      font-weight: 600;
    }
    .out {
      color: var(--muted);
    }
    label {
      display: block;
      font-size: 14px;
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
      font-size: 14px;
      margin: 0.25rem 0;
    }
    @media (max-width: 900px) {
      :host {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
    }
  `,
})
export class StatementReview {
  private readonly api = inject(DraftsApi);
  private readonly injector = inject(Injector);
  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');
  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('editButton');

  readonly draftId = input.required<string>();
  readonly statement = input.required<DraftStatement>();
  /** A resume entry's title line, shown in bold. */
  readonly entry = input(false);
  /** The draft, checked again after a change. */
  readonly changed = output<Draft>();

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly status = signal('');
  protected readonly text = linkedSignal(() => this.statement().text);

  protected setEditing(editing: boolean) {
    this.editing.set(editing);
    afterNextRender(() => (editing ? this.area() : this.editButton())?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected async save(change: EditStatementRequest) {
    this.busy.set(true);
    this.failure.set('');
    this.status.set('');
    try {
      this.changed.emit(await this.api.editStatement(this.draftId(), this.statement().id, change));
      this.setEditing(false);
      this.status.set('Saved and checked. Read the wording against its evidence.');
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
