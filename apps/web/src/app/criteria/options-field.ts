import { Component, ElementRef, input, model, output, signal, viewChild } from '@angular/core';
import { FormField, type FormValueControl, form } from '@angular/forms/signals';

/** A short list of alternatives, edited as individual removable options. */
@Component({
  selector: 'app-options-field',
  imports: [FormField],
  template: `
    <label [for]="controlId()">{{ label() }}</label>
    <p class="hint" [id]="controlId() + '-help'">
      {{ hint() }} Press Enter or Add to keep an option.
    </p>
    <div class="entry">
      <input
        #entry
        type="text"
        [id]="controlId()"
        [formField]="entryForm.text"
        [attr.aria-describedby]="
          controlId() + '-help' + (invalid() ? ' ' + controlId() + '-error' : '')
        "
        [attr.aria-invalid]="invalid() || null"
        (keydown.enter)="$event.preventDefault(); add()"
        (blur)="touch.emit()"
      />
      <button type="button" [disabled]="disabled()" (click)="add()">Add</button>
    </div>
    @if (problem()) {
      <p role="alert">{{ problem() }}</p>
    }
    @if (value().length) {
      <ul [attr.aria-label]="label() + ' options'">
        @for (option of value(); track $index) {
          <li>
            <span>{{ option }}</span>
            <button
              type="button"
              [disabled]="disabled()"
              [attr.aria-label]="'Remove ' + option"
              (click)="remove($index)"
            >
              Remove
            </button>
          </li>
        }
      </ul>
    } @else {
      <p class="hint">No options added.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 36rem;
    }
    .entry {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      list-style: none;
      padding: 0;
      margin: 12px 0 20px;
    }
    li {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-left: 12px;
      border: 1px solid var(--control);
      border-radius: 6px;
      background: var(--layer);
    }
    li span {
      min-width: 0;
    }
    li button {
      border-color: transparent;
      background: transparent;
      font-size: 13px;
    }
    @media (max-width: 600px) {
      li {
        max-width: 100%;
      }
    }
  `,
})
export class OptionsField implements FormValueControl<string[]> {
  readonly value = model.required<string[]>();
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly controlId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly touch = output<void>();
  readonly added = output<void>();
  private readonly entry = viewChild.required<ElementRef<HTMLInputElement>>('entry');
  private readonly entryModel = signal({ text: '' });
  protected readonly entryForm = form(this.entryModel);
  protected readonly problem = signal('');

  protected add() {
    if (this.disabled()) return;
    const text = this.entryModel().text.trim().replace(/\s+/g, ' ');
    if (!text) return;
    if (text.length > 100 || this.value().length >= 50) {
      this.problem.set('Use up to 50 options, with at most 100 characters each.');
      return;
    }
    if (!this.value().some((entry) => entry.toLowerCase() === text.toLowerCase())) {
      this.value.update((entries) => [...entries, text]);
      this.added.emit();
    }
    this.entryModel.set({ text: '' });
    this.problem.set('');
    this.focus();
  }

  protected remove(index: number) {
    if (this.disabled()) return;
    this.value.update((entries) => entries.filter((_, i) => i !== index));
    this.problem.set('');
    this.focus();
  }

  focus(options?: FocusOptions) {
    this.entry().nativeElement.focus(options);
  }
}
