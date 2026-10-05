import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AccessMethod, AlertSection, SourcesResponse } from '@jsa/shared';
import { AlertSource } from './alert-source';
import { CatalogEntryCard } from './catalog-entry';
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
      'Sites the app does not request, because their terms forbid it or they have no API an individual can use. Set up job alerts on the site and import the emails. Emails of a source you turn off are not imported, and its jobs are hidden.',
  },
  { access: 'manual', title: 'Any other site', intro: '' },
];

const alertSections: { section: AlertSection; title: string }[] = [
  { section: 'platforms', title: 'Popular job platforms' },
  { section: 'freelance', title: 'Freelance' },
  { section: 'company', title: 'Company career alerts' },
  { section: 'government', title: 'Government' },
  { section: 'optional', title: 'Optional' },
];

@Component({
  selector: 'app-sources',
  imports: [AlertSource, CatalogEntryCard, RouterLink],
  template: `
    <h1>Sources</h1>
    <p>
      Where the app finds jobs. Which locations count is one of your
      <a routerLink="/criteria">criteria</a>; it filters the jobs found and does not change which
      sources are used or how.
    </p>

    <section aria-labelledby="sources-heading">
      <h2 id="sources-heading">Catalog</h2>
      @if (data.hasValue()) {
        @for (group of entriesByAccess(); track group.access) {
          <section [attr.aria-labelledby]="'access-' + group.access">
            <h3 [id]="'access-' + group.access">{{ group.title }}</h3>
            @if (group.intro) {
              <p>{{ group.intro }}</p>
            }
            @if (group.access === 'email_alert') {
              <p><a routerLink="/jobs/alerts">Import job-alert emails</a></p>
              @for (section of alertGroups(); track section.section) {
                <section [attr.aria-labelledby]="'alerts-' + section.section">
                  <h4 [id]="'alerts-' + section.section">{{ section.title }}</h4>
                  @for (item of section.entries; track item.entry.id) {
                    <app-alert-source
                      [entry]="item.entry"
                      [source]="item.sources[0]"
                      [stats]="item.stats"
                      (changed)="data.reload()"
                    />
                  }
                </section>
              }
            } @else {
              @for (item of group.entries; track item.entry.id) {
                <app-catalog-entry
                  [entry]="item.entry"
                  [sources]="item.sources"
                  (changed)="data.reload()"
                />
              }
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

  /** Job-alert sources by section, each with what was imported for it. */
  protected readonly alertGroups = computed(() => {
    const data = this.data.value();
    if (!data) return [];
    const alerts = this.entriesByAccess().find((group) => group.access === 'email_alert');
    return alertSections
      .map(({ section, title }) => ({
        section,
        title,
        entries: (alerts?.entries ?? [])
          .filter(({ entry }) => entry.alert?.section === section)
          .map((item) => ({
            ...item,
            stats: data.alerts.find((stats) => stats.catalogId === item.entry.id),
          })),
      }))
      .filter((group) => group.entries.length > 0);
  });
}
