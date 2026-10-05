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
    <p>
      Open jobs on the job boards you use, and jobs you pasted, saved or imported from alert emails,
      sorted by when they were posted and grouped by your hard
      <a routerLink="/criteria">criteria</a>. Choose the boards on the
      <a routerLink="/sources">Sources</a> page. Open a job to read, summarise and match it with
      your facts.
    </p>
    <p>
      <a routerLink="/jobs/paste">Paste a job</a> from any other site,
      <a routerLink="/jobs/alerts">import job-alert emails</a>, or browse the site in the desktop
      app and save the job you are looking at.
    </p>

    <form [formRoot]="runForm">
      <label>
        Eligible jobs you want (optional)
        <input type="number" step="1" [formField]="runForm.target" />
      </label>
      <button type="submit" [disabled]="runForm().submitting()">Find jobs</button>
      <p role="status">
        @if (runForm().submitting()) {
          Reading your job boards. This can take a minute.
        }
      </p>
      @if (runForm.target().errors().length) {
        <p class="error" role="alert">{{ runForm.target().errors()[0].message }}</p>
      }
      @for (error of runForm().errors(); track $index) {
        <p class="error" role="alert">{{ error.message }}</p>
      }
    </form>

    @if (lastRun(); as run) {
      <section aria-labelledby="run-heading">
        <h2 id="run-heading">Last run</h2>
        <app-run-summary [run]="run" [counts]="counts()" [target]="runTarget()" />
      </section>
    }

    @if (data.hasValue()) {
      <p>Location: {{ scopeLabel() }}.</p>
      <section aria-labelledby="eligible-heading">
        <h2 id="eligible-heading">Eligible ({{ groups().eligible.length }})</h2>
        @if (groups().eligible.length) {
          <app-job-list [jobs]="groups().eligible" />
        } @else {
          <p>No eligible jobs yet.</p>
        }
      </section>
      @if (groups().toConfirm.length) {
        <section aria-labelledby="to-confirm-heading">
          <h2 id="to-confirm-heading">To confirm ({{ groups().toConfirm.length }})</h2>
          <p>
            The job does not say enough for a hard criterion, so it is not ruled out. Summarise it,
            match it with your facts, or check the job page.
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
    } @else if (data.isLoading()) {
      <p role="status">Loading jobs…</p>
    } @else {
      <p class="error" role="alert">The jobs could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    form label {
      margin-right: 0.5rem;
    }
    form input {
      width: 5rem;
    }
    summary h2 {
      display: inline;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Jobs {
  private readonly http = inject(HttpClient);

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
          this.lastRun.set(undefined);
          let run: DiscoveryRun;
          try {
            run = await firstValueFrom(this.http.post<DiscoveryRun>('/api/discovery-runs', {}));
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
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
