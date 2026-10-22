import { DOCUMENT } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal, DestroyRef } from '@angular/core';
import { FormField, FormRoot, disabled, form, validate } from '@angular/forms/signals';
import type {
  Criteria,
  CriterionStrength,
  EmploymentType,
  IfUnknown,
  SearchScope,
} from '@jsa/shared';
import { firstValueFrom, timeout } from 'rxjs';
import { errorMessage } from '../sources/sources-api';
import { CriterionStrengthFields } from './criterion-strength';
import { OptionsField } from './options-field';

export const employmentLabels: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  permanent: 'Permanent',
  fixed_term: 'Fixed-term',
  contract: 'Contract or freelance',
  internship: 'Internship or trainee',
};

const employmentTypes = Object.keys(employmentLabels) as EmploymentType[];

interface Rule {
  strength: CriterionStrength;
  ifUnknown: IfUnknown;
}

/** The criteria as the form edits them: lists are comma-separated text, types are checkboxes. */
interface Model {
  area: SearchScope['area'];
  includeRemote: boolean;
  places: string[];
  location: Rule;
  title: { strength: CriterionStrength; words: string[] };
  avoid: { strength: CriterionStrength; words: string };
  languages: Rule & { names: string };
  employment: Rule & { types: Record<EmploymentType, boolean> };
  mustHaves: Rule;
}

const list = (text: string) =>
  text
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');

function toModel(c: Criteria): Model {
  return {
    area: c.location.area,
    includeRemote: c.location.includeRemote,
    places: c.location.places ?? [],
    location: { strength: c.location.strength, ifUnknown: c.location.ifUnknown },
    title: { strength: c.title.strength, words: c.title.words },
    avoid: { strength: c.avoidInTitle.strength, words: c.avoidInTitle.words.join(', ') },
    languages: { ...c.languages, names: c.languages.languages.join(', ') },
    employment: {
      strength: c.employmentType.strength,
      ifUnknown: c.employmentType.ifUnknown,
      types: Object.fromEntries(
        employmentTypes.map((type) => [type, c.employmentType.types.includes(type)]),
      ) as Record<EmploymentType, boolean>,
    },
    mustHaves: c.mustHaves,
  };
}

function toCriteria(m: Model): Criteria {
  return {
    location: {
      ...m.location,
      area: m.area,
      includeRemote: m.includeRemote,
      ...(m.area === 'custom' ? { places: m.places } : {}),
    },
    title: { strength: m.title.strength, words: m.title.words },
    avoidInTitle: { strength: m.avoid.strength, words: list(m.avoid.words) },
    languages: {
      strength: m.languages.strength,
      ifUnknown: m.languages.ifUnknown,
      languages: list(m.languages.names),
    },
    employmentType: {
      strength: m.employment.strength,
      ifUnknown: m.employment.ifUnknown,
      types: employmentTypes.filter((type) => m.employment.types[type]),
    },
    mustHaves: m.mustHaves,
  };
}

const blank: Criteria = {
  location: { strength: 'hard', ifUnknown: 'to_confirm', area: 'worldwide', includeRemote: false },
  title: { strength: 'off', words: [] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { strength: 'off', ifUnknown: 'to_confirm', languages: [] },
  employmentType: { strength: 'off', ifUnknown: 'to_confirm', types: [] },
  mustHaves: { strength: 'preference', ifUnknown: 'to_confirm' },
};

/** The user's criteria: which jobs count as eligible, to confirm or ruled out. */
@Component({
  selector: 'app-criteria',
  imports: [CriterionStrengthFields, FormField, FormRoot, OptionsField],
  template: `
    <h1>Criteria</h1>
    <p>
      Which jobs are eligible. A job that fails a <strong>hard</strong> criterion is ruled out; one
      that does not say goes to To confirm, or is ruled out if you choose that. Not saying never
      counts as meeting a criterion. A <strong>preference</strong> helps rank jobs without ruling
      them out. The app checks jobs when it lists them, so a change applies at once and sends
      nothing anywhere.
    </p>

    @if (saved.hasValue()) {
      <form [formRoot]="criteriaForm">
        <fieldset class="form-fields" [disabled]="criteriaForm().submitting()">
          <section aria-labelledby="location-heading">
            <h2 id="location-heading">Location</h2>
            <p class="hint">
              Add cities, regions or countries anywhere in the world. A job can match any selected
              place. Remote restrictions still need to allow work from one of your places.
            </p>
            <fieldset>
              <legend>Jobs located in</legend>
              <label>
                <input type="radio" value="custom" [formField]="criteriaForm.area" /> Selected
                locations
              </label>
              <label>
                <input type="radio" value="helsinki" [formField]="criteriaForm.area" /> Helsinki and
                Espoo
              </label>
              <label>
                <input type="radio" value="finland" [formField]="criteriaForm.area" /> Finland
              </label>
              <label>
                <input type="radio" value="worldwide" [formField]="criteriaForm.area" /> Anywhere
              </label>
            </fieldset>
            @if (criteriaForm.area().value() === 'custom') {
              <app-options-field
                controlId="location-options"
                label="Add a location"
                hint="For example Berlin, Stockholm or Germany. Country options include jobs across that country."
                [formField]="criteriaForm.places"
              />
              @for (error of criteriaForm.places().errors(); track $index) {
                <p class="error" role="alert" id="location-options-error">{{ error.message }}</p>
              }
            }
            <button type="button" [disabled]="locating()" (click)="locate()">
              {{ locating() ? 'Finding your location…' : 'Use current location' }}
            </button>
            <p class="hint">
              With your browser’s permission, your coordinates go to
              <a
                href="https://www.bigdatacloud.com/privacy-and-cookie-policy"
                target="_blank"
                rel="noopener noreferrer"
                >BigDataCloud</a
              >
              to suggest a city and country. Choose what to add; only selected names are saved.
            </p>
            @if (locationMessage()) {
              <p role="status">{{ locationMessage() }}</p>
            }
            @if (locationFailure()) {
              <p role="alert">{{ locationFailure() }}</p>
            }
            @if (suggestedPlaces().length) {
              <div class="actions" aria-label="Suggested locations">
                @for (place of suggestedPlaces(); track place) {
                  <button type="button" (click)="addPlace(place)">Add {{ place }}</button>
                }
              </div>
            }
            <label class="line">
              <input type="checkbox" [formField]="criteriaForm.includeRemote" />
              Also remote jobs
              @if (criteriaForm.includeRemote().disabled()) {
                (already included)
              }
            </label>
            <app-criterion-strength
              [strength]="criteriaForm.location.strength"
              [ifUnknown]="criteriaForm.location.ifUnknown"
              unknownLabel="If the location is missing or unclear (when hard)"
            />
          </section>

          <section aria-labelledby="title-heading">
            <h2 id="title-heading">Job title</h2>
            <app-options-field
              controlId="job-title-options"
              label="Add a job title"
              hint="For example Backend Engineer or Product Designer. Any one option can match the title."
              [formField]="criteriaForm.title.words"
              (added)="enableTitlePreference()"
            />
            <p class="hint">
              Adding a title enables Preference to rank matching roles first. Choose Hard to rule
              out other titles, or Off to stop checking them.
            </p>
            <app-criterion-strength [strength]="criteriaForm.title.strength" />
            @for (error of criteriaForm.title.words().errors(); track $index) {
              <p class="error" role="alert" id="job-title-options-error">{{ error.message }}</p>
            }
          </section>

          <section aria-labelledby="avoid-heading">
            <h2 id="avoid-heading">Words to avoid in the title</h2>
            <label class="line">
              Words the title should not have (separate with commas)
              <input type="text" [formField]="criteriaForm.avoid.words" />
            </label>
            <app-criterion-strength [strength]="criteriaForm.avoid.strength" />
            @for (error of criteriaForm.avoid.words().errors(); track $index) {
              <p class="error" role="alert">{{ error.message }}</p>
            }
          </section>

          <section aria-labelledby="languages-heading">
            <h2 id="languages-heading">Working language</h2>
            <p class="hint">
              Compared with the working language the job’s summary quotes from its text, so a job is
              unknown here until it is summarised. A job that also asks for a language you did not
              list goes to To confirm.
            </p>
            <label class="line">
              Languages you can work in (separate with commas)
              <input type="text" [formField]="criteriaForm.languages.names" />
            </label>
            <app-criterion-strength
              [strength]="criteriaForm.languages.strength"
              [ifUnknown]="criteriaForm.languages.ifUnknown"
            />
            @for (error of criteriaForm.languages.names().errors(); track $index) {
              <p class="error" role="alert">{{ error.message }}</p>
            }
          </section>

          <section aria-labelledby="employment-heading">
            <h2 id="employment-heading">Employment type</h2>
            <p class="hint">
              Compared with the employment type the job’s summary quotes. Hours (full-time or
              part-time) and the kind of contract are checked separately, each only if you accept a
              type of it.
            </p>
            <fieldset>
              <legend>Types you accept</legend>
              @for (type of employmentTypes; track type) {
                <label>
                  <input type="checkbox" [formField]="criteriaForm.employment.types[type]" />
                  {{ employmentLabels[type] }}
                </label>
              }
            </fieldset>
            <app-criterion-strength
              [strength]="criteriaForm.employment.strength"
              [ifUnknown]="criteriaForm.employment.ifUnknown"
            />
            @for (error of criteriaForm.employment.types().errors(); track $index) {
              <p class="error" role="alert">{{ error.message }}</p>
            }
          </section>

          <section aria-labelledby="must-heading">
            <h2 id="must-heading">The job’s must-haves</h2>
            <p class="hint">
              Whether your confirmed facts meet the must-haves of the job, from its latest match
              with your facts on the job page. Unknown until the job is summarised and matched, and
              again when a fact the match cited changes.
            </p>
            <app-criterion-strength
              [strength]="criteriaForm.mustHaves.strength"
              [ifUnknown]="criteriaForm.mustHaves.ifUnknown"
            />
          </section>
        </fieldset>
        <div class="actions">
          <button type="submit" [disabled]="!unsaved() || criteriaForm().submitting()">Save</button>
        </div>
        <p role="status">
          {{
            criteriaForm().submitting()
              ? 'Saving criteria…'
              : unsaved()
                ? 'Unsaved changes.'
                : status() || 'No unsaved changes.'
          }}
        </p>
        @if (failure()) {
          <p class="error" role="alert">{{ failure() }}</p>
        }
      </form>
    } @else if (saved.isLoading()) {
      <p role="status">Loading your criteria…</p>
    } @else {
      <p class="error" role="alert">Your criteria could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="saved.reload()">Try again</button>
    }
  `,
  styles: `
    section {
      border-top: 1px solid var(--line);
      margin-top: 1rem;
    }
    fieldset:not(.form-fields) {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1.5rem;
      margin: 0 0 0.5rem;
    }
    .line {
      display: block;
      margin-bottom: 0.5rem;
    }
    input[type='text'] {
      display: block;
      width: 100%;
      max-width: 30rem;
      box-sizing: border-box;
    }
  `,
})
export class CriteriaPage {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly employmentTypes = employmentTypes;
  protected readonly employmentLabels = employmentLabels;

  protected readonly saved = httpResource<Criteria>(() => '/api/criteria');
  protected readonly loadError = computed(() => errorMessage(this.saved.error()));

  // Follows the saved criteria; the user's edits stay local until saved.
  private readonly model = linkedSignal<Model>(() =>
    toModel(this.saved.hasValue() ? this.saved.value() : blank),
  );

  protected readonly status = signal('');
  protected readonly failure = signal('');

  protected readonly unsaved = computed(() => {
    const saved = this.saved.hasValue() ? this.saved.value() : undefined;
    return (
      !saved ||
      JSON.stringify(toCriteria(this.model())) !== JSON.stringify(toCriteria(toModel(saved)))
    );
  });

  protected readonly locating = signal(false);
  protected readonly suggestedPlaces = signal<string[]>([]);
  protected readonly locationMessage = signal('');
  protected readonly locationFailure = signal('');

  protected enableTitlePreference() {
    this.model.update((m) =>
      m.title.strength === 'off' ? { ...m, title: { ...m.title, strength: 'preference' } } : m,
    );
  }

  protected addPlace(place: string) {
    if (this.criteriaForm().submitting()) return;
    const current = this.model();
    const places =
      current.area === 'helsinki'
        ? ['Helsinki', 'Espoo']
        : current.area === 'finland'
          ? ['Finland']
          : current.places;
    if (places.length >= 50) {
      this.locationFailure.set(
        'Keep at most 50 location options. Remove one before adding another.',
      );
      return;
    }
    this.model.update((m) => ({
      ...m,
      area: 'custom',
      places: places.some((entry) => entry.toLowerCase() === place.toLowerCase())
        ? places
        : [...places, place],
    }));
    this.locationMessage.set(`Added ${place}. Save to apply your locations.`);
  }

  protected async locate() {
    if (this.locating() || this.criteriaForm().submitting()) return;
    this.locationFailure.set('');
    this.locationMessage.set('');
    this.suggestedPlaces.set([]);
    const geolocation = this.document.defaultView?.navigator.geolocation;
    if (!geolocation) {
      this.locationFailure.set('Location is unavailable in this browser. Add a location manually.');
      return;
    }
    this.locating.set(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 0,
        }),
      );
      if (this.destroyRef.destroyed) return;
      // The free client endpoint accepts only the calling device’s live, permission-granted coordinates.
      const response = await firstValueFrom(
        this.http
          .get<{ city?: unknown; locality?: unknown; countryName?: unknown }>(
            'https://api.bigdatacloud.net/data/reverse-geocode-client',
            {
              params: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                localityLanguage: 'en',
              },
            },
          )
          .pipe(timeout(10000)),
      );
      if (this.destroyRef.destroyed) return;
      const places = [response.city || response.locality, response.countryName]
        .filter(
          (name): name is string =>
            typeof name === 'string' && name.trim().length > 0 && name.length <= 100,
        )
        .map((name) => name.trim());
      if (!places.length) throw new Error('No place names returned.');
      this.suggestedPlaces.set([...new Set(places)]);
      this.locationMessage.set(
        'Choose a suggested city or country, or add another location manually.',
      );
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        const denied =
          typeof error === 'object' && error !== null && 'code' in error && error.code === 1;
        this.locationFailure.set(
          denied
            ? 'Location permission was denied. Add a location manually or enable location access in your browser.'
            : 'Your location could not be found. Try again or add a location manually.',
        );
      }
    } finally {
      if (!this.destroyRef.destroyed) this.locating.set(false);
    }
  }

  protected readonly criteriaForm = form(
    this.model,
    (s) => {
      disabled(s.includeRemote, { when: ({ valueOf }) => valueOf(s.area) === 'worldwide' });
      validate(s.places, ({ value, valueOf }) =>
        valueOf(s.area) === 'custom' && value().length === 0
          ? { kind: 'required', message: 'Add at least one location, or choose Anywhere.' }
          : undefined,
      );
      const needs = (message: string) => (strength: CriterionStrength, empty: boolean) =>
        strength !== 'off' && empty ? { kind: 'required', message } : undefined;
      const words = needs('Add at least one word, or turn this criterion off.');
      validate(s.title.words, ({ value, valueOf }) =>
        words(valueOf(s.title.strength), value().length === 0),
      );
      validate(s.avoid.words, ({ value, valueOf }) =>
        words(valueOf(s.avoid.strength), list(value()).length === 0),
      );
      validate(s.languages.names, ({ value, valueOf }) =>
        needs('Add at least one language, or turn this criterion off.')(
          valueOf(s.languages.strength),
          list(value()).length === 0,
        ),
      );
      validate(s.employment.types, ({ value, valueOf }) =>
        needs('Tick at least one type, or turn this criterion off.')(
          valueOf(s.employment.strength),
          !Object.values(value()).some(Boolean),
        ),
      );
    },
    {
      submission: {
        action: async (f) => {
          this.status.set('');
          this.failure.set('');
          try {
            const criteria = toCriteria(f().value());
            this.saved.set(
              await firstValueFrom(this.http.put<Criteria>('/api/criteria', criteria)),
            );
          } catch (error) {
            this.failure.set(errorMessage(error));
            return undefined;
          }
          this.status.set('Saved.');
          return undefined;
        },
      },
    },
  );
}
