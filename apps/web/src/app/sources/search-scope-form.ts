import { httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, disabled, form } from '@angular/forms/signals';
import type { SearchScope } from '@jsa/shared';
import { SourcesApi, errorMessage } from './sources-api';

/** The search scope: which locations count. It filters jobs and never changes the sources. */
@Component({
  selector: 'app-search-scope-form',
  imports: [FormField, FormRoot],
  template: `
    @if (saved.hasValue()) {
      <form [formRoot]="scopeForm">
        <fieldset>
          <legend>Jobs located in</legend>
          <label>
            <input type="radio" value="helsinki" [formField]="scopeForm.area" /> Helsinki and Espoo
          </label>
          <label>
            <input type="radio" value="finland" [formField]="scopeForm.area" /> Finland
          </label>
          <label>
            <input type="radio" value="worldwide" [formField]="scopeForm.area" /> Anywhere
          </label>
        </fieldset>
        <label>
          <input type="checkbox" [formField]="scopeForm.includeRemote" />
          Also remote jobs
          @if (scopeForm.includeRemote().disabled()) {
            (already included)
          }
        </label>
        <p>
          <button type="submit" [disabled]="!unsaved() || scopeForm().submitting()">Save</button>
          <span role="status">{{ status() }}</span>
        </p>
        @for (error of scopeForm().errors(); track $index) {
          <p class="error" role="alert">{{ error.message }}</p>
        }
      </form>
    } @else if (saved.isLoading()) {
      <p role="status">Loading the search scope…</p>
    } @else {
      <p class="error" role="alert">The search scope could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    fieldset {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1.5rem;
      margin: 0 0 0.75rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class SearchScopeForm {
  private readonly api = inject(SourcesApi);

  protected readonly saved = httpResource<SearchScope>(() => '/api/search-scope');
  protected readonly loadError = computed(() => errorMessage(this.saved.error()));

  // Follows the saved scope; the user's edits stay local until saved.
  private readonly model = linkedSignal<SearchScope>(
    () => this.saved.value() ?? { area: 'helsinki', includeRemote: false },
  );

  protected readonly status = signal('');

  protected readonly unsaved = computed(() => {
    const saved = this.saved.value();
    const model = this.model();
    return !saved || saved.area !== model.area || saved.includeRemote !== model.includeRemote;
  });

  protected readonly scopeForm = form(
    this.model,
    (s) => {
      disabled(s.includeRemote, { when: ({ valueOf }) => valueOf(s.area) === 'worldwide' });
    },
    {
      submission: {
        action: async (f) => {
          this.status.set('');
          try {
            this.saved.set(await this.api.saveScope(f().value()));
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          this.status.set('Saved.');
          return undefined;
        },
      },
    },
  );
}
