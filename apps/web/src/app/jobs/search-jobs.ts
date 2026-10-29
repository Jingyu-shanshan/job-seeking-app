import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type {
  JobDetail,
  DuplicateJob,
  JobSearchCandidate,
  JobSearchRequest,
  JobSearchResponse,
  ToolCalls,
} from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi, duplicateJobs } from './jobs-api';
import { DuplicateJobNotice } from './duplicate-job';

@Component({
  selector: 'app-search-jobs',
  imports: [FormField, FormRoot, RouterLink, DuplicateJobNotice],
  template: `
    <h1>Search for job links</h1>
    <p><a routerLink="/jobs">Back to jobs</a></p>
    <p>
      Search Greenhouse and Ashby with DeepSeek. Only the role, location and sources you choose are
      sent. Keep personal details out. Search snippets are not the full job description.
    </p>
    @if (availability.error()) {
      <p role="alert">{{ errorMessage(availability.error()) }}</p>
      <button type="button" (click)="availability.reload()">Reload search availability</button>
    }
    @if (availability.hasValue()) {
      <p id="search-fee">
        Estimated search fee: US$ {{ availability.value().estimatedCostUsd }}. Empty results and
        confirmed failures cost zero; unknown outcomes keep the estimate. Verifying a chosen link
        uses its official board API, without paid model analysis.
      </p>
      @if (!availability.value().available) {
        <p role="alert">
          Set DEEPSEEK_API_KEY on the server to search. You can still add a job by link or paste.
        </p>
      }
      <form [formRoot]="searchForm" [attr.aria-busy]="searchForm().submitting()">
        <fieldset
          class="form-fields"
          [disabled]="searchForm().submitting() || !!pending() || !availability.value().available"
        >
          <label
            >Role<input
              [formField]="searchForm.role"
              autocomplete="off"
              aria-describedby="search-fee search-input-error"
          /></label>
          <label
            >Location<input
              [formField]="searchForm.location"
              autocomplete="off"
              aria-describedby="search-input-error"
          /></label>
          <fieldset>
            <legend>Sources for this search</legend>
            <label class="check"
              ><input type="checkbox" [formField]="searchForm.greenhouse" />Greenhouse</label
            >
            <label class="check"
              ><input type="checkbox" [formField]="searchForm.ashby" />Ashby</label
            >
            <p class="hint">
              These choices do not add or enable company boards for ongoing discovery.
            </p>
          </fieldset>
          @if (searchForm().touched() && searchForm().invalid()) {
            <p role="alert" id="search-input-error">{{ searchForm().errorSummary()[0].message }}</p>
          }
          <button class="primary" type="submit">
            {{ searchForm().submitting() ? 'Searching…' : 'Search with DeepSeek' }}
          </button>
        </fieldset>
      </form>
    }
    @if (failure()) {
      <p role="alert">{{ failure() }}</p>
    }
    @if (pending() && !searchForm().submitting()) {
      <p>
        The response was lost. Retry the same request to check its saved result without a second
        search charge.
      </p>
      <button type="button" [disabled]="checking()" (click)="retrySearch()">
        Retry / check same search
      </button>
    }
    @if (result(); as search) {
      <section aria-labelledby="candidates-heading">
        <h2 id="candidates-heading">Candidate job links</h2>
        <p class="query">Searched: {{ search.query }}</p>
        <p role="status">
          {{ search.message }} {{ search.estimated ? 'Estimated / reserved' : 'Recorded fee' }}: US$
          {{ search.costUsd }}.
        </p>
        <p>
          Choose a link to check that it is still listed and save the full official job text.
          Location and other criteria are checked from the saved job, never from these snippets.
        </p>
        @for (candidate of search.candidates; track candidate.url) {
          <article>
            <h3>{{ candidate.title || 'Untitled search result' }}</h3>
            <p class="address">{{ candidate.url }}</p>
            <p class="hint">Search snippet · not verified</p>
            <p>{{ candidate.snippet }}</p>
            @if (saved()[candidate.url]; as job) {
              <p role="status">
                Verified and saved: {{ job.title }} · {{ job.location || 'Location unknown' }} ·
                {{ verdictLabels[job.verdict] }}.
              </p>
              <a [routerLink]="['/jobs', job.id]">Open saved job and review criteria</a>
            } @else {
              <button type="button" [disabled]="!!verifying()" (click)="verify(candidate)">
                {{
                  verifying() === candidate.url
                    ? 'Verifying…'
                    : errors()[candidate.url]
                      ? 'Retry verification and save'
                      : 'Verify and save job'
                }}
              </button>
            }
            @if (duplicates()[candidate.url]; as jobs) {
              <app-duplicate-job
                [jobs]="jobs"
                [busy]="!!verifying()"
                (createAnother)="verify(candidate, true)"
              />
            }
            @if (errors()[candidate.url]; as message) {
              <p role="alert">{{ message }}</p>
              <p>
                Your existing jobs and text are kept. If you can read the job yourself,
                <a routerLink="/jobs/paste">paste its text</a> or save it in the desktop app.
              </p>
            }
          </article>
        } @empty {
          <p>
            No candidate job links are available from the selected sources. Adjust the role or
            location to search again.
          </p>
        }
        @if (search.ignored.length) {
          <details>
            <summary>Skipped results ({{ search.ignored.length }})</summary>
            @for (item of search.ignored; track $index) {
              <p>{{ item.title }}: {{ item.reason }}</p>
            }
          </details>
        }
      </section>
    }
  `,
  styles: `
    article {
      border-top: 1px solid var(--line);
      padding-block: 20px;
    }
    .address,
    .query {
      overflow-wrap: anywhere;
    }
    form {
      margin-block: 24px;
    }
  `,
})
export class SearchJobs {
  private readonly api = inject(JobsApi);
  protected readonly errorMessage = errorMessage;
  protected readonly verdictLabels = {
    eligible: 'Meets hard criteria',
    to_confirm: 'Criteria to confirm',
    ineligible: 'Ruled out by hard criteria',
  };
  protected readonly availability = httpResource<Pick<ToolCalls, 'available' | 'estimatedCostUsd'>>(
    () => '/api/job-searches',
  );
  protected readonly model = signal({
    role: '',
    location: 'Helsinki',
    greenhouse: true,
    ashby: true,
  });
  protected readonly result = signal<JobSearchResponse | null>(null);
  protected readonly failure = signal('');
  protected readonly pending = signal<JobSearchRequest | null>(null);
  protected readonly checking = signal(false);
  protected readonly verifying = signal('');
  protected readonly saved = signal<Record<string, JobDetail>>({});
  protected readonly duplicates = signal<Record<string, DuplicateJob[] | null>>({});
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly searchForm = form(
    this.model,
    (s) => {
      required(s.role, { message: 'Enter a role.' });
      required(s.location, { message: 'Enter a location.' });
      maxLength(s.role, 100, { message: 'Shorten the role to 100 characters.' });
      maxLength(s.location, 100, { message: 'Shorten the location to 100 characters.' });
      validate(s.greenhouse, ({ value, valueOf }) =>
        value() || valueOf(s.ashby)
          ? undefined
          : { kind: 'sources', message: 'Choose Greenhouse or Ashby.' },
      );
    },
    {
      submission: {
        action: async () => {
          const model = this.model();
          const request: JobSearchRequest = {
            id: crypto.randomUUID(),
            role: model.role,
            location: model.location,
            sources: [
              ...(model.greenhouse ? ['greenhouse_board' as const] : []),
              ...(model.ashby ? ['ashby_board' as const] : []),
            ],
            maxCostUsd: this.availability.value()!.estimatedCostUsd,
          };
          this.pending.set(request);
          await this.send(request);
        },
      },
    },
  );

  private async send(request: JobSearchRequest) {
    this.failure.set('');
    try {
      this.result.set(await this.api.search(request));
      this.pending.set(null);
    } catch (error) {
      this.failure.set(errorMessage(error));
      if (error instanceof HttpErrorResponse && [400, 401, 403, 409, 503].includes(error.status))
        this.pending.set(null);
    }
  }
  protected async retrySearch() {
    const request = this.pending();
    if (!request || this.checking()) return;
    this.checking.set(true);
    try {
      await this.send(request);
    } finally {
      this.checking.set(false);
    }
  }
  protected async verify(candidate: JobSearchCandidate, createNew = false) {
    if (this.verifying() || (createNew && !this.duplicates()[candidate.url])) return;
    this.verifying.set(candidate.url);
    this.errors.update((errors) => ({ ...errors, [candidate.url]: '' }));
    try {
      const job = await this.api.importLink(candidate.url, 'direct', createNew);
      this.duplicates.update((jobs) => ({ ...jobs, [candidate.url]: null }));
      this.saved.update((saved) => ({ ...saved, [candidate.url]: job }));
    } catch (error) {
      const jobs = duplicateJobs(error);
      if (jobs || !createNew)
        this.duplicates.update((duplicates) => ({ ...duplicates, [candidate.url]: jobs }));
      this.errors.update((errors) => ({
        ...errors,
        [candidate.url]: jobs ? '' : errorMessage(error),
      }));
    } finally {
      this.verifying.set('');
    }
  }
}
