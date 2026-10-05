import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormField, FormRoot, form, pattern, required } from '@angular/forms/signals';
import type { AccessMethod, CatalogEntry, Source } from '@jsa/shared';
import { SourceStatus } from './source-status';
import { SourcesApi, errorMessage } from './sources-api';

const accessLabels: Record<AccessMethod, string> = {
  board_api: 'Public job board API',
  official_api: 'Official API, with your own key',
  email_alert: 'Job-alert emails you import',
  manual: 'You bring the job: paste it or save its page',
};

/**
 * One catalog entry: what it is, how it is accessed, and the user's sources of it. Job-alert
 * sources have their own, shorter rows (alert-source.ts).
 */
@Component({
  selector: 'app-catalog-entry',
  imports: [FormField, FormRoot, SourceStatus],
  template: `
    @let e = entry();
    <h4>{{ e.name }}</h4>
    <p>{{ e.note }}</p>
    <dl>
      <dt>Access</dt>
      <dd>{{ accessLabel() }}</dd>
      <dt>Terms checked</dt>
      <dd>
        @if (e.terms; as terms) {
          <a [href]="terms.url" target="_blank" rel="noopener noreferrer">{{ terms.checkedOn }}</a>
        } @else {
          Not needed: you bring the content.
        }
      </dd>
      <dt>Request limit</dt>
      <dd>{{ rateLimit() }}</dd>
    </dl>

    @if (e.param; as param) {
      @if (sources().length) {
        <ul>
          @for (source of sources(); track source.id) {
            <li>
              <label>
                <input
                  #enabled
                  type="checkbox"
                  [checked]="source.enabled"
                  [disabled]="busy()"
                  (change)="setEnabled(source, enabled)"
                />
                Use <strong>{{ source.param }}</strong>
              </label>
              <button
                type="button"
                [disabled]="busy()"
                [attr.aria-label]="'Remove ' + source.param + ' from ' + e.name"
                (click)="remove(source)"
              >
                Remove
              </button>
              <app-source-status [source]="source" />
            </li>
          }
        </ul>
      } @else {
        <p>None added yet.</p>
      }
      <form [formRoot]="addForm">
        <label>
          {{ param.label }}
          <input
            [formField]="addForm.param"
            autocomplete="off"
            spellcheck="false"
            [attr.aria-describedby]="e.id + '-hint'"
          />
        </label>
        <button
          type="submit"
          [disabled]="addForm().submitting()"
          [attr.aria-label]="'Add to ' + e.name"
        >
          Add
        </button>
        <p class="hint" [id]="e.id + '-hint'">{{ param.hint }}</p>
        @if (addForm.param().touched() && addForm.param().errors().length) {
          <p class="error" role="alert">{{ addForm.param().errors()[0].message }}</p>
        }
      </form>
    } @else {
      <p>Always available.</p>
    }
    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: 0.5rem;
      padding: 0 1rem 1rem;
      margin-bottom: 1rem;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0;
    }
    ul {
      padding-left: 0;
      list-style: none;
    }
    li {
      margin-bottom: 0.75rem;
    }
    li button {
      margin-left: 0.5rem;
    }
    form label {
      margin-right: 0.5rem;
    }
    .hint {
      margin: 0.25rem 0;
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class CatalogEntryCard {
  private readonly api = inject(SourcesApi);

  readonly entry = input.required<CatalogEntry>();
  /** The user's sources of this entry. */
  readonly sources = input.required<Source[]>();
  /** A source was added, changed or removed; the parent reloads the list. */
  readonly changed = output();

  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected readonly accessLabel = computed(() => accessLabels[this.entry().access]);

  protected readonly rateLimit = computed(() => {
    const limit = this.entry().rateLimit;
    if (!limit) return 'The app never requests this site.';
    const requests = limit.requests === 1 ? 'one request' : `${limit.requests} requests`;
    return `At most ${requests} every ${limit.perSeconds} seconds.`;
  });

  private readonly addModel = signal({ param: '' });

  protected readonly addForm = form(
    this.addModel,
    (s) => {
      required(s.param, { message: 'Enter a name.' });
      // The hint under the field says what to enter instead.
      pattern(s.param, () => this.paramPattern(), {
        message: () => `${this.entry().param?.label} is not valid.`,
      });
    },
    {
      submission: {
        action: async (f) => {
          try {
            await this.api.add(this.entry().id, f.param().value().trim());
          } catch (error) {
            return { kind: 'server', message: errorMessage(error), fieldTree: f.param };
          }
          f().reset({ param: '' });
          this.changed.emit();
          return undefined;
        },
      },
    },
  );

  private readonly paramPattern = computed(() => {
    const param = this.entry().param;
    return param ? new RegExp(param.pattern) : undefined;
  });

  protected setEnabled(source: Source, box: HTMLInputElement) {
    return this.mutate(() => this.api.setEnabled(source.id, box.checked), box);
  }

  protected remove(source: Source) {
    return this.mutate(() => this.api.remove(source.id));
  }

  /** Runs one change. When it fails, the checkbox that started it goes back to its old state. */
  private async mutate(change: () => Promise<unknown>, box?: HTMLInputElement) {
    this.busy.set(true);
    this.failure.set('');
    try {
      await change();
    } catch (error) {
      if (box) box.checked = !box.checked;
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
      this.changed.emit();
    }
  }
}
