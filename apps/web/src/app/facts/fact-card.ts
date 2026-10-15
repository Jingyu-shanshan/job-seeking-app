import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { Fact, UpdateFactVersionRequest } from '@jsa/shared';
import { factSourceLabel } from '@jsa/shared/fact-import';
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
  host: { '[class.withdrawn]': "fact().current.status === 'retired'" },
  template: `
    @let f = fact();
    <p class="status">
      <span class="tag" [class.todo]="f.current.status === 'proposed'">{{ status() }}</span>
      Version {{ f.current.version }} · Source: {{ sourceLabel(f.current.source) }}
    </p>

    @if (editing()) {
      <label>
        Text
        <textarea rows="4" [value]="draft()" (input)="draft.set(area.value)" #area></textarea>
      </label>
      <p class="hint">
        Saving adds a new version to confirm with both permissions off. The old one is kept.
      </p>
      <button type="button" [disabled]="busy()" (click)="saveEdit()">Save</button>
      <button type="button" [disabled]="busy()" (click)="editing.set(false)">Cancel</button>
    } @else {
      <p class="body">{{ f.current.body }}</p>
    }

    @if (f.current.status === 'retired') {
      <p class="hint">
        Retained permissions — DeepSeek:
        {{ f.current.maySendToModel ? 'allowed' : 'not allowed' }} · Materials:
        {{ f.current.mayUseInMaterials ? 'allowed' : 'not allowed' }}. Confirming again keeps these
        choices and re-enables the allowed uses.
      </p>
    } @else {
      <p class="hint">
        Usable in materials: {{ f.usableInMaterials ? 'yes' : 'no' }} · Allowed for DeepSeek:
        {{ f.sendableToModel ? 'yes' : 'no' }}
      </p>
      <details>
        <summary>Permissions</summary>
        <p class="hint">
          These are independent permissions, not records of past use. They take effect only while
          this version is confirmed.
        </p>
        <label>
          <input
            #model
            type="checkbox"
            [checked]="f.current.maySendToModel"
            [disabled]="busy() || f.sensitive.length > 0"
            (change)="update({ maySendToModel: model.checked }, model)"
          />
          Allow sending to DeepSeek
        </label>
        <label>
          <input
            #materials
            type="checkbox"
            [checked]="f.current.mayUseInMaterials"
            [disabled]="busy()"
            (change)="update({ mayUseInMaterials: materials.checked }, materials)"
          />
          Allow use in materials
        </label>
      </details>
    }
    @if (f.sensitive.length) {
      <p class="hint">It contains {{ f.sensitive.join(' and ') }}, so it never goes to DeepSeek.</p>
    }

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
              {{ v.body }} · Source: {{ sourceLabel(v.source) }}
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
    :host.withdrawn {
      border-style: dashed;
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
    button,
    summary,
    details label {
      min-height: 2.75rem;
      align-content: center;
    }
    summary {
      cursor: pointer;
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

  protected readonly sourceLabel = factSourceLabel;

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
