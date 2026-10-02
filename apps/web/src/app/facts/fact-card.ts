import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { Fact, UpdateFactVersionRequest } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { FactsApi } from './facts-api';

const statusLabels: Record<Fact['current']['status'], string> = {
  proposed: 'To confirm',
  confirmed: 'Confirmed',
  retired: 'Withdrawn',
};

@Component({
  selector: 'app-fact-card',
  imports: [DatePipe],
  template: `
    @let f = fact();
    <p class="status">
      <span class="tag" [class.todo]="f.current.status === 'proposed'">{{ status() }}</span>
      Version {{ f.current.version }}
      @if (f.current.source === 'markdown') {
        · imported from Markdown
      }
    </p>

    @if (editing()) {
      <label>
        Text
        <textarea rows="4" [value]="draft()" (input)="draft.set(area.value)" #area></textarea>
      </label>
      <p class="hint">Saving adds a new version that you confirm again. The old one is kept.</p>
      <button type="button" [disabled]="busy()" (click)="saveEdit()">Save</button>
      <button type="button" [disabled]="busy()" (click)="editing.set(false)">Cancel</button>
    } @else {
      <p class="body">{{ f.current.body }}</p>
    }

    <div class="flags">
      <label>
        <input
          #model
          type="checkbox"
          [checked]="f.current.maySendToModel"
          [disabled]="busy() || f.sensitive.length > 0"
          (change)="update({ maySendToModel: model.checked }, model)"
        />
        May be sent to DeepSeek
      </label>
      <label>
        <input
          #materials
          type="checkbox"
          [checked]="f.current.mayUseInMaterials"
          [disabled]="busy()"
          (change)="update({ mayUseInMaterials: materials.checked }, materials)"
        />
        May appear in resumes and cover letters
      </label>
    </div>
    @if (f.sensitive.length) {
      <p class="hint">It contains {{ f.sensitive.join(' and ') }}, so it never goes to DeepSeek.</p>
    }
    <p class="hint">
      Used in materials: {{ f.usableInMaterials ? 'yes' : 'no' }} · Sent to DeepSeek:
      {{ f.sendableToModel ? 'yes' : 'no' }}
    </p>

    <div class="actions">
      @if (f.current.status !== 'confirmed') {
        <button type="button" [disabled]="busy()" (click)="update({ status: 'confirmed' })">
          {{ f.current.status === 'retired' ? 'Confirm again' : 'Confirm' }}
        </button>
      }
      @if (f.current.status !== 'retired') {
        <button type="button" [disabled]="busy()" (click)="update({ status: 'retired' })">
          Withdraw
        </button>
      }
      @if (!editing()) {
        <button type="button" [disabled]="busy()" (click)="editing.set(true)">Edit</button>
      }
    </div>

    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }

    @if (f.earlier.length) {
      <details>
        <summary>Earlier versions ({{ f.earlier.length }})</summary>
        <ul>
          @for (v of f.earlier; track v.id) {
            <li>
              Version {{ v.version }}, {{ v.createdAt | date: 'd MMM y' }}, {{ statusLabel(v) }}:
              {{ v.body }}
            </li>
          }
        </ul>
      </details>
    }
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      margin-bottom: 0.75rem;
    }
    .status {
      margin: 0;
      font-size: 0.9rem;
    }
    .tag {
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
    }
    .todo {
      font-weight: 600;
    }
    .body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    label {
      display: block;
    }
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
    }
    .actions button,
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
export class FactCard {
  private readonly api = inject(FactsApi);

  readonly fact = input.required<Fact>();
  readonly changed = output<Fact>();

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly editing = signal(false);
  protected readonly draft = linkedSignal(() => this.fact().current.body);
  protected readonly status = computed(() => statusLabels[this.fact().current.status]);

  protected statusLabel(version: Fact['current']) {
    return statusLabels[version.status].toLowerCase();
  }

  protected update(change: UpdateFactVersionRequest, box?: HTMLInputElement) {
    return this.run(() => this.api.update(this.fact().current.id, change), box);
  }

  protected async saveEdit() {
    if (await this.run(() => this.api.edit(this.fact().id, this.draft()))) {
      this.editing.set(false);
    }
  }

  private async run(change: () => Promise<Fact>, box?: HTMLInputElement) {
    this.busy.set(true);
    this.failure.set('');
    try {
      this.changed.emit(await change());
      return true;
    } catch (error) {
      if (box) box.checked = !box.checked;
      this.failure.set(errorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
