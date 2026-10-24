import { HttpClient, httpResource } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, min, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { DiscoveryRun, Job, JobsResponse, SearchScope } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';
import { JobList } from './job-list';
import { JobsApi } from './jobs-api';
import { RunSummary } from './run-summary';

const areaLabels: Record<SearchScope['area'], string> = {
  helsinki: 'Helsinki and Espoo',
  finland: 'Finland',
  worldwide: 'anywhere',
  custom: 'selected locations',
};

/** The jobs the user's sources list now, grouped by the user's criteria, and a way to look again. */
@Component({
  selector: 'app-jobs',
  imports: [FormField, FormRoot, JobList, RouterLink, RunSummary],
  template: `
    <h1>Jobs</h1>
    <p>
      Matching roles first, grouped by your hard <a routerLink="/criteria">criteria</a>. Job title
      matches lead each group, followed by your other preferences.
    </p>
    @if (data.hasValue() && data.value().jobs.length) {
      <section class="filters" aria-label="Job filters">
        <label>
          Status
          <select #statusFilter [value]="status()" (change)="status.set(statusFilter.value)">
            <option value="all">All statuses</option>
            <option value="eligible">Eligible</option>
            <option value="to_confirm">To confirm</option>
            <option value="ineligible">Ruled out</option>
            <option value="submitted">Applied</option>
            <option value="to_verify">Application result unknown</option>
            <option value="not_applied">Not applied</option>
            <option value="needs_text">Needs job text</option>
          </select>
        </label>
        <label>
          Added from
          <input #from type="date" [value]="addedFrom()" (change)="addedFrom.set(from.value)" />
        </label>
        <label>
          Added through
          <input #until type="date" [value]="addedUntil()" (change)="addedUntil.set(until.value)" />
        </label>
        <label>
          Sort by
          <select #sortBy [value]="sort()" (change)="sort.set(sortBy.value)">
            <option value="relevance">Best matches</option>
            <option value="newest">Added: newest first</option>
            <option value="oldest">Added: oldest first</option>
            <option value="posted">Posted: newest first</option>
            <option value="title">Job title: A to Z</option>
            <option value="company">Company: A to Z</option>
            <option value="status">Status</option>
          </select>
        </label>
        <div class="filter-result">
          <span class="meta" aria-live="polite">
            {{ visibleJobs().length }} of {{ data.value().jobs.length }} jobs
          </span>
          @if (status() !== 'all' || addedFrom() || addedUntil() || sort() !== 'relevance') {
            <button type="button" (click)="resetFilters()">Reset filters</button>
          }
        </div>
      </section>
      @if (addedFrom() && addedUntil() && addedFrom() > addedUntil()) {
        <p class="error" role="alert">Choose an end date on or after the start date.</p>
      } @else if (!visibleJobs().length) {
        <p role="status">No jobs match these filters. Change the status or date range.</p>
      }
    }
    <p role="status" tabindex="-1" #deleteNotice>{{ deletionNotice() }}</p>
    <section aria-labelledby="imported-heading">
      <h2 id="imported-heading">
        Your imported jobs{{ data.hasValue() ? ' (' + imported().length + ')' : '' }}
      </h2>
      <p>
        Jobs you pasted, added by link, saved, or imported from job-alert emails stay together here.
      </p>
      <div class="actions">
        <a class="button" routerLink="/jobs/search">Search for job links</a>
        <a class="button primary" routerLink="/jobs/paste">Add text or link</a>
        <a class="button" routerLink="/jobs/alerts">Import job-alert emails</a>
      </div>
      @if (data.hasValue()) {
        @if (imported().length) {
          <app-job-list
            [jobs]="imported()"
            [busy]="deleting()"
            [failure]="deleteFailure()"
            (deleteRequested)="removeJob($event)"
          />
        } @else {
          <p class="hint">
            {{
              hasFilters()
                ? 'No imported jobs match these filters.'
                : 'No imported jobs yet. Add a job’s text or link, or import an alert email.'
            }}
          </p>
        }
      }
    </section>
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
      } @else if (
        groups().eligible.length + groups().toConfirm.length + groups().ineligible.length
      ) {
        <section aria-labelledby="eligible-heading">
          <h2 id="eligible-heading">Eligible ({{ groups().eligible.length }})</h2>
          @if (groups().eligible.length) {
            <app-job-list
              [jobs]="groups().eligible"
              [busy]="deleting()"
              [failure]="deleteFailure()"
              (deleteRequested)="removeJob($event)"
            />
          } @else if (hasFilters()) {
            <p class="hint">No eligible jobs match these filters.</p>
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
            <app-job-list
              [jobs]="groups().toConfirm"
              [busy]="deleting()"
              [failure]="deleteFailure()"
              (deleteRequested)="removeJob($event)"
            />
          </section>
        }
        @if (groups().ineligible.length) {
          <details>
            <summary>
              <h2>Ruled out ({{ groups().ineligible.length }})</h2>
            </summary>
            <p>Each says which hard criterion ruled it out.</p>
            <app-job-list
              [jobs]="groups().ineligible"
              [busy]="deleting()"
              [failure]="deleteFailure()"
              (deleteRequested)="removeJob($event)"
            />
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
    .filters {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px 16px;
      padding: 20px 0;
      border-block: 1px solid var(--line);
      margin: 24px 0;
    }
    .filters label {
      display: grid;
      align-content: start;
      gap: 6px;
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .filters select {
      width: 100%;
    }
    .filter-result {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    @media (max-width: 1100px) {
      .filters {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 480px) {
      .filters {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class Jobs {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JobsApi);
  private readonly injector = inject(Injector);
  private readonly deleteNotice = viewChild.required<ElementRef<HTMLElement>>('deleteNotice');
  protected readonly failure = signal('');
  protected readonly status = signal('all');
  protected readonly sort = signal('relevance');
  protected readonly addedFrom = signal('');
  protected readonly addedUntil = signal('');
  protected readonly deletionNotice = signal('');
  protected readonly deleting = signal(false);
  protected readonly deleteFailure = signal<{ id: string; message: string } | null>(null);
  protected readonly hasFilters = computed(
    () => this.status() !== 'all' || !!this.addedFrom() || !!this.addedUntil(),
  );

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
    return `${scope.area === 'custom' ? scope.places?.join(', ') || 'no locations selected' : areaLabels[scope.area]}, ${remote}`;
  });

  protected readonly visibleJobs = computed(() => {
    const status = this.status();
    const from = this.addedFrom() ? new Date(`${this.addedFrom()}T00:00:00`).getTime() : -Infinity;
    const until = this.addedUntil()
      ? new Date(`${this.addedUntil()}T00:00:00`).getTime()
      : Infinity;
    const jobs = (this.data.value()?.jobs ?? []).filter((job) => {
      const added = new Date(job.firstSeenAt);
      added.setHours(0, 0, 0, 0);
      return (
        added.getTime() >= from &&
        added.getTime() <= until &&
        (status === 'all' ||
          job.verdict === status ||
          job.application === status ||
          (status === 'not_applied' && job.application === null) ||
          (status === 'needs_text' && job.needsText))
      );
    });
    switch (this.sort()) {
      case 'newest':
        return jobs.sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt));
      case 'oldest':
        return jobs.sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
      case 'posted':
        return jobs.sort(
          (a, b) =>
            (b.publishedAt ? Date.parse(b.publishedAt) : -Infinity) -
            (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity),
        );
      case 'title':
        return jobs.sort((a, b) => a.title.localeCompare(b.title));
      case 'company':
        return jobs.sort((a, b) =>
          (a.company ?? a.sources[0]?.param ?? '').localeCompare(
            b.company ?? b.sources[0]?.param ?? '',
          ),
        );
      case 'status':
        return jobs.sort((a, b) =>
          (a.application ?? a.verdict).localeCompare(b.application ?? b.verdict),
        );
      default:
        return jobs;
    }
  });

  protected readonly imported = computed(() =>
    this.visibleJobs().filter((job) => job.imported || job.origin !== 'discovered'),
  );

  protected resetFilters() {
    this.status.set('all');
    this.addedFrom.set('');
    this.addedUntil.set('');
    this.sort.set('relevance');
  }

  protected async removeJob(job: Job) {
    if (this.deleting()) return;
    this.deleting.set(true);
    this.deleteFailure.set(null);
    try {
      await this.api.remove(job.id);
      this.data.update(
        (data) => data && { ...data, jobs: data.jobs.filter((j) => j.id !== job.id) },
      );
      this.deletionNotice.set(
        `${job.title} deleted from the job list. Saved text, drafts and application history are kept.`,
      );
      afterNextRender(() => this.deleteNotice().nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      this.deleteFailure.set({ id: job.id, message: errorMessage(error) });
    } finally {
      this.deleting.set(false);
    }
  }

  protected readonly groups = computed(() => {
    const jobs = this.visibleJobs().filter((job) => !job.imported && job.origin === 'discovered');
    return {
      eligible: jobs.filter((job) => job.verdict === 'eligible'),
      toConfirm: jobs.filter((job) => job.verdict === 'to_confirm'),
      ineligible: jobs.filter((job) => job.verdict === 'ineligible'),
    };
  });

  protected readonly counts = computed(() => {
    const jobs = this.data.value()?.jobs ?? [];
    return {
      eligible: jobs.filter((job) => job.verdict === 'eligible').length,
      toConfirm: jobs.filter((job) => job.verdict === 'to_confirm').length,
      ineligible: jobs.filter((job) => job.verdict === 'ineligible').length,
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
