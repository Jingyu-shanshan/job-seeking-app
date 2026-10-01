import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import type { AccessMethod, SourcesResponse } from '@jsa/shared';
import { CatalogEntryCard } from './catalog-entry';
import { SearchScopeForm } from './search-scope-form';
import { errorMessage } from './sources-api';

const groups: { access: AccessMethod; title: string; intro: string }[] = [
  {
    access: 'board_api',
    title: 'Company job boards',
    intro: 'The app reads only the boards you add and keep in use, no faster than the limit shown.',
  },
  {
    access: 'official_api',
    title: 'Official APIs',
    intro: 'A site’s own API, with a key you apply for on that site.',
  },
  {
    access: 'email_alert',
    title: 'Job-alert emails',
    intro:
      'Sites the app does not request, because their terms forbid it or they have no API an individual can use. Set up job alerts on the site and import the emails.',
  },
  { access: 'manual', title: 'Any other site', intro: '' },
];

@Component({
  selector: 'app-sources',
  imports: [CatalogEntryCard, SearchScopeForm],
  template: `
    <h1>Sources and search scope</h1>

    <section aria-labelledby="scope-heading">
      <h2 id="scope-heading">Search scope</h2>
      <p>
        Which jobs count by location. The scope only filters the jobs found; it does not change
        which sources are used or how.
      </p>
      <app-search-scope-form />
    </section>

    <section aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      @if (data.hasValue()) {
        @for (group of entriesByAccess(); track group.access) {
          <section [attr.aria-labelledby]="'access-' + group.access">
            <h3 [id]="'access-' + group.access">{{ group.title }}</h3>
            @if (group.intro) {
              <p>{{ group.intro }}</p>
            }
            @for (item of group.entries; track item.entry.id) {
              <app-catalog-entry
                [entry]="item.entry"
                [sources]="item.sources"
                (changed)="data.reload()"
              />
            }
          </section>
        }
      } @else if (data.isLoading()) {
        <p role="status">Loading sources…</p>
      } @else {
        <p class="error" role="alert">The sources could not be loaded. {{ loadError() }}</p>
      }
    </section>
  `,
  styles: `
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Sources {
  protected readonly data = httpResource<SourcesResponse>(() => '/api/sources');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  /** The catalog grouped by access method, each entry with the user's sources of it. */
  protected readonly entriesByAccess = computed(() => {
    const data = this.data.value();
    if (!data) return [];
    return groups
      .map((group) => ({
        ...group,
        entries: data.catalog
          .filter((entry) => entry.access === group.access)
          .map((entry) => ({
            entry,
            sources: data.sources.filter((source) => source.catalogId === entry.id),
          })),
      }))
      .filter((group) => group.entries.length > 0);
  });
}
