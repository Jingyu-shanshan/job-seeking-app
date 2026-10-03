import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, disabled, form, validate } from '@angular/forms/signals';
import type {
  Criteria,
  CriterionStrength,
  EmploymentType,
  IfUnknown,
  SearchScope,
} from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';
import { CriterionStrengthFields } from './criterion-strength';

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
  location: Rule;
  title: { strength: CriterionStrength; words: string };
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
    location: { strength: c.location.strength, ifUnknown: c.location.ifUnknown },
    title: { strength: c.title.strength, words: c.title.words.join(', ') },
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
    location: { ...m.location, area: m.area, includeRemote: m.includeRemote },
    title: { strength: m.title.strength, words: list(m.title.words) },
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
  location: { strength: 'hard', ifUnknown: 'to_confirm', area: 'helsinki', includeRemote: false },
  title: { strength: 'off', words: [] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { strength: 'off', ifUnknown: 'to_confirm', languages: [] },
  employmentType: { strength: 'off', ifUnknown: 'to_confirm', types: [] },
  mustHaves: { strength: 'preference', ifUnknown: 'to_confirm' },
};

/** The user's criteria: which jobs count as eligible, to confirm or ruled out. */
@Component({
  selector: 'app-criteria',
  imports: [CriterionStrengthFields, FormField, FormRoot],
  template: `
    <h1>Criteria</h1>
    <p>
      Which jobs are eligible. A job that fails a <strong>hard</strong> criterion is ruled out; one
      that does not say goes to To confirm, or is ruled out if you choose that. Not saying never
      counts as meeting a criterion. A <strong>preference</strong> is only shown on the job. The app
      checks jobs when it lists them, so a change applies at once and sends nothing anywhere.
    </p>

    @if (saved.hasValue()) {
      <form [formRoot]="criteriaForm">
        <section aria-labelledby="location-heading">
          <h2 id="location-heading">Location</h2>
          <p class="hint">
            From the location the job board or you gave. Helsinki includes Espoo, not Vantaa. A
            remote job counts only if it may be done from Finland.
          </p>
          <fieldset>
            <legend>Jobs located in</legend>
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
          <label class="line">
            Words the title should have, any one of them (separate with commas)
            <input type="text" [formField]="criteriaForm.title.words" />
          </label>
          <app-criterion-strength [strength]="criteriaForm.title.strength" />
          @for (error of criteriaForm.title.words().errors(); track $index) {
            <p class="error" role="alert">{{ error.message }}</p>
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
            Whether your confirmed facts meet the must-haves of the job, from its latest match with
            your facts on the job page. Unknown until the job is summarised and matched, and again
            when a fact the match cited changes.
          </p>
          <app-criterion-strength
            [strength]="criteriaForm.mustHaves.strength"
            [ifUnknown]="criteriaForm.mustHaves.ifUnknown"
          />
        </section>

        <p>
          <button type="submit" [disabled]="!unsaved() || criteriaForm().submitting()">Save</button>
          <span role="status">{{ status() }}</span>
        </p>
        @for (error of criteriaForm().errors(); track $index) {
          <p class="error" role="alert">{{ error.message }}</p>
        }
      </form>
    } @else if (saved.isLoading()) {
      <p role="status">Loading your criteria…</p>
    } @else {
      <p class="error" role="alert">Your criteria could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    section {
      border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      margin-top: 1rem;
    }
    fieldset {
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
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class CriteriaPage {
  private readonly http = inject(HttpClient);

  protected readonly employmentTypes = employmentTypes;
  protected readonly employmentLabels = employmentLabels;

  protected readonly saved = httpResource<Criteria>(() => '/api/criteria');
  protected readonly loadError = computed(() => errorMessage(this.saved.error()));

  // Follows the saved criteria; the user's edits stay local until saved.
  private readonly model = linkedSignal<Model>(() => toModel(this.saved.value() ?? blank));

  protected readonly status = signal('');

  protected readonly unsaved = computed(() => {
    const saved = this.saved.value();
    return !saved || JSON.stringify(toCriteria(this.model())) !== JSON.stringify(saved);
  });

  protected readonly criteriaForm = form(
    this.model,
    (s) => {
      disabled(s.includeRemote, { when: ({ valueOf }) => valueOf(s.area) === 'worldwide' });
      const needs = (message: string) => (strength: CriterionStrength, empty: boolean) =>
        strength !== 'off' && empty ? { kind: 'required', message } : undefined;
      const words = needs('Add at least one word, or turn this criterion off.');
      validate(s.title.words, ({ value, valueOf }) =>
        words(valueOf(s.title.strength), list(value()).length === 0),
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
          try {
            const criteria = toCriteria(f().value());
            this.saved.set(
              await firstValueFrom(this.http.put<Criteria>('/api/criteria', criteria)),
            );
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
