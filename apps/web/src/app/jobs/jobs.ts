import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, min, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { DiscoveryRun, JobsResponse, SearchScope } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';
import { JobList } from './job-list';
import { RunSummary } from './run-summary';

const areaLabels: Record<SearchScope['area'], string> = {
  helsinki: 'Helsinki and Espoo',
  finland: 'Finland',
  worldwide: 'anywhere',
};

/** The jobs the user's sources list now, grouped by the user's criteria, and a way to look again. */
@Component({
  selector: 'app-jobs',
  imports: [FormField, FormRoot, JobList, RouterLink, RunSummary],
  template: `
    <h1>Jobs</h1>
    <p>Jobs from your sources, grouped by your hard <a routerLink="/criteria">criteria</a>.</p>
    <div class="actions">
      <a class="button primary" routerLink="/jobs/paste">Paste a job</a>
      <a class="button" routerLink="/jobs/alerts">Import job-alert emails</a>
    </div>
    <details>
      <summary>Save a job in the desktop app</summary>
      <p>
        Browse the site in the desktop app, open the job description and press “Save this job”.
        Saving a results page keeps only its visible listings; each job still needs its original
        text.
      </p>
    </details>

    <section aria-labelledby="discovery-heading">
      <h2 id="discovery-heading">Read your boards</h2>
      <p class="hint">
        Only enabled Greenhouse and Ashby boards are read. Choose them on
        <a routerLink="/sources">Sources</a>. Use <a routerLink="/runs">Runs</a> to save presets and
        prepare jobs in the background with a budget.
      </p>

      <form [formRoot]="runForm">
        <label>
          Eligible jobs you want (optional)
          <input type="number" step="1" [formField]="runForm.target" />
        </label>
        <button type="submit" [disabled]="runForm().submitting()">
          {{ runForm().submitting() ? 'Reading boards…' : 'Find jobs' }}
        </button>
        <p role="status">
          @if (runForm().submitting()) {
            Reading your job boards. This can take a minute.
          }
        </p>
        @if (runForm.target().errors().length) {
          <p class="error" role="alert">{{ runForm.target().errors()[0].message }}</p>
        }
        @if (failure()) {
          <p class="error" role="alert">{{ failure() }}</p>
        }
      </form>
    </section>

    @if (lastRun(); as run) {
      <section aria-labelledby="run-heading">
        <h2 id="run-heading">Last run</h2>
        <app-run-summary
          [run]="run"
          [counts]="data.hasValue() && !data.isLoading() ? counts() : null"
          [target]="runTarget()"
        />
      </section>
    }

    @if (data.hasValue()) {
      <p class="meta">Location: {{ scopeLabel() }}.</p>
      @if (data.value().jobs.length === 0) {
        <h2>No jobs yet</h2>
        <p>
          Paste an original job description, import a job-alert email, save a page in the desktop
          app, or enable a supported board on <a routerLink="/sources">Sources</a> and choose Find
          jobs.
        </p>
      } @else {
        <section aria-labelledby="eligible-heading">
          <h2 id="eligible-heading">Eligible ({{ groups().eligible.length }})</h2>
          @if (groups().eligible.length) {
            <app-job-list [jobs]="groups().eligible" />
          } @else {
            <p class="warning">
              No jobs currently meet all your hard criteria. Read To confirm or expand Ruled out to
              see why, or <a routerLink="/criteria">review your criteria</a>. Unknown information is
              not a pass.
            </p>
          }
        </section>
        @if (groups().toConfirm.length) {
          <section aria-labelledby="to-confirm-heading">
            <h2 id="to-confirm-heading">To confirm ({{ groups().toConfirm.length }})</h2>
            <p>
              The job does not say enough for a hard criterion, so it is not ruled out. Summarise
              it, match it with your facts, or check the job page.
            </p>
            <app-job-list [jobs]="groups().toConfirm" />
          </section>
        }
        @if (groups().ineligible.length) {
          <details>
            <summary>
              <h2>Ruled out ({{ groups().ineligible.length }})</h2>
            </summary>
            <p>Each says which hard criterion ruled it out.</p>
            <app-job-list [jobs]="groups().ineligible" />
          </details>
        }
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading jobs…</p>
    } @else {
      <p class="error" role="alert">The jobs could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
    }
  `,
  styles: `
    form label {
      display: grid;
      gap: 4px;
      max-width: 24rem;
    }
    form input {
      width: 8rem;
    }
    summary h2 {
      display: inline;
    }
  `,
})
export class Jobs {
  private readonly http = inject(HttpClient);
  protected readonly failure = signal('');

  protected readonly data = httpResource<JobsResponse>(() => '/api/jobs');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly lastRun = signal<DiscoveryRun | undefined>(undefined);
  /** The target the last run was started with. */
  protected readonly runTarget = signal<number | null>(null);

  protected readonly scopeLabel = computed(() => {
    const scope = this.data.value()?.scope;
    if (!scope) return '';
    if (scope.area === 'worldwide') return 'anywhere, remote jobs included';
    const remote = scope.includeRemote ? 'remote jobs included' : 'remote jobs not included';
    return `${areaLabels[scope.area]}, ${remote}`;
  });

  protected readonly groups = computed(() => {
    const jobs = this.data.value()?.jobs ?? [];
    return {
      eligible: jobs.filter((job) => job.verdict === 'eligible'),
      toConfirm: jobs.filter((job) => job.verdict === 'to_confirm'),
      ineligible: jobs.filter((job) => job.verdict === 'ineligible'),
    };
  });

  protected readonly counts = computed(() => {
    const { eligible, toConfirm, ineligible } = this.groups();
    return {
      eligible: eligible.length,
      toConfirm: toConfirm.length,
      ineligible: ineligible.length,
    };
  });

  private readonly runModel = signal<{ target: number | null }>({ target: null });

  protected readonly runForm = form(
    this.runModel,
    (s) => {
      min(s.target, 1, { message: 'Enter a whole number of at least 1, or leave it empty.' });
      validate(s.target, ({ value }) => {
        const target = value();
        return target === null || Number.isInteger(target)
          ? undefined
          : { kind: 'integer', message: 'Enter a whole number of at least 1, or leave it empty.' };
      });
    },
    {
      submission: {
        action: async (f) => {
          this.failure.set('');
          this.lastRun.set(undefined);
          let run: DiscoveryRun;
          try {
            run = await firstValueFrom(this.http.post<DiscoveryRun>('/api/discovery-runs', {}));
          } catch (error) {
            this.failure.set(errorMessage(error));
            return undefined;
          }
          this.runTarget.set(f.target().value());
          this.lastRun.set(run);
          this.data.reload();
          return undefined;
        },
      },
    },
  );
}
