import { HttpClient, httpResource } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  FormField,
  FormRoot,
  form,
  min,
  max,
  required,
  maxLength,
  validate,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { Run, RunConfig, RunPreset, RunsResponse } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';
import { employmentLabels } from '../criteria/criteria';

const defaults: RunConfig = {
  name: 'My job search',
  discoveryLimit: 20,
  materialLimit: 0,
  submissionLimit: 0,
  requestLimit: 20,
  timeLimitSeconds: 600,
  costLimitUsd: 0,
  intervalHours: 0,
};
@Component({
  selector: 'app-runs',
  imports: [FormField, FormRoot, RouterLink, DatePipe, DecimalPipe],
  template: `
    <h1>Runs</h1>
    <p>
      Save a preset, then find jobs and prepare drafts in the background. Each run captures your
      enabled <a routerLink="/sources">sources</a>, <a routerLink="/criteria">criteria</a> and
      limits. Review drafts and PDFs on each job page. Every submission still needs your individual
      approval.
    </p>
    <details class="run-help">
      <summary>How jobs are found and matched</summary>
      <p>
        Runs read enabled Greenhouse and Ashby company boards from Sources. Add the companies you
        want to follow there. Runs do not search the whole web or add new sources.
      </p>
      <p>
        Criteria checks titles and locations first, using any existing job analysis too. Title
        options match words or phrases, not synonyms. Hard conditions can exclude jobs; preferences
        do not exclude them. Jobs are admitted in processing order, not by best match.
      </p>
      <p>
        With new drafts enabled, the run reads job descriptions, summarises requirements and
        compares them with your confirmed Facts that you allow sending to DeepSeek. Missing evidence
        stays unknown. It checks Criteria again before writing drafts. Without new drafts, it skips
        new AI summaries and matching. Every submission still needs your individual approval.
      </p>
    </details>
    <p class="hint">
      Runs prepare jobs and drafts. The Runner handles application forms separately, after you start
      a fill. Runs never fill forms, approve or submit them.
    </p>
    <details open>
      <summary>
        <h2>{{ editing() ? 'Edit preset' : 'New preset' }}</h2>
      </summary>
      <form [formRoot]="configForm">
        <fieldset class="form-fields" [disabled]="busy() || configForm().submitting()">
          <div class="field name">
            <label for="run-name">Preset name</label>
            <input id="run-name" [formField]="configForm.name" aria-describedby="run-name-help" />
            <p class="hint" id="run-name-help">A name to recognise and reuse these settings.</p>
          </div>
          <div class="fields">
            <div class="field">
              <label for="run-jobs">Max jobs</label>
              <input
                id="run-jobs"
                type="number"
                step="1"
                [formField]="configForm.discoveryLimit"
                aria-describedby="run-jobs-help"
              />
              <p class="hint" id="run-jobs-help">
                Maximum jobs admitted after initial screening, not a target or a best-match ranking.
              </p>
            </div>
            <div class="field">
              <label for="run-drafts">Max new documents</label>
              <input
                id="run-drafts"
                type="number"
                step="1"
                [formField]="configForm.materialLimit"
                aria-describedby="run-drafts-help"
              />
              <p class="hint" id="run-drafts-help">
                Each resume or cover letter counts as one. 0 skips new AI summaries, matching and
                drafts.
              </p>
            </div>
            <div class="field">
              <label for="run-submissions">Submission limit</label>
              <input
                id="run-submissions"
                type="number"
                step="1"
                [formField]="configForm.submissionLimit"
                aria-describedby="run-submissions-help"
              />
              <p class="hint" id="run-submissions-help">
                Each submission needs your approval. 0 blocks fills linked to this run.
              </p>
            </div>
            <div class="field">
              <label for="run-requests">Request limit</label>
              <input
                id="run-requests"
                type="number"
                step="1"
                [formField]="configForm.requestLimit"
                aria-describedby="run-requests-help"
              />
              <p class="hint" id="run-requests-help">
                Shared by board reads, job text and AI calls. One job can use several requests.
              </p>
            </div>
            <div class="field">
              <label for="run-time">Time limit (seconds)</label>
              <input
                id="run-time"
                type="number"
                step="1"
                [formField]="configForm.timeLimitSeconds"
                aria-describedby="run-time-help"
              />
              <p class="hint" id="run-time-help">
                Total running time, including request waits. 600 seconds is 10 minutes.
              </p>
            </div>
            <div class="field">
              <label for="run-cost">Estimated budget per run (USD)</label>
              <input
                id="run-cost"
                type="number"
                step="0.01"
                [formField]="configForm.costLimitUsd"
                aria-describedby="run-cost-help"
              />
              <p class="hint" id="run-cost-help">
                0 blocks paid requests, including AI calls. This is an estimate, not a bill.
              </p>
            </div>
            <div class="field">
              <label for="run-repeat">Repeat interval (hours)</label>
              <input
                id="run-repeat"
                type="number"
                step="1"
                [formField]="configForm.intervalHours"
                aria-describedby="run-repeat-help"
              />
              <p class="hint" id="run-repeat-help">
                0 turns repeat off. 48 means every 2 days. Saving a nonzero interval enables the
                schedule.
              </p>
            </div>
          </div>
        </fieldset>
        <details class="run-help">
          <summary>How limits and retries work</summary>
          <p>
            All limits apply together. A run can stop before reaching its job or document limit if
            requests, time or estimated cost run out. Resume keeps all counts and costs; it does not
            refill an exhausted budget.
          </p>
          <p>
            Existing documents are skipped. A resume and cover letter for one job use two new
            document slots. A failed draft keeps its slot for retry. Complete boards are saved; the
            job limit applies only to jobs admitted to this run. Unknown information follows your
            Criteria settings.
          </p>
          <p>
            To prepare new documents, confirm your Facts, allow model use and set a positive
            estimated budget. DeepSeek must also be configured for this app.
          </p>
        </details>
        <p class="notice">
          Preparing drafts sends job text and the facts you allowed to DeepSeek outside the EU. The
          cost budget uses peak-price estimates, not the provider’s bill. A request with unknown
          usage keeps its full reserved estimate, even after a timeout. Resuming keeps all counts
          and costs.
        </p>
        <p class="hint">
          Paid requests, new AI preparation, run-linked fills and repeat are off by default. Saving
          a preset with repeat off does not start a run; choose Start run separately.
        </p>
        @if (model().intervalHours > 0) {
          <p>
            Saving this preset enables a scheduled run every {{ model().intervalHours }} hours. The
            first scheduled run is due after this interval; choose Start run to run immediately.
            Repeating runs get a new budget each time while the server is online. A stopped or
            failed run pauses this preset’s schedule until you resume it. Missed times are not
            replayed.
          </p>
        }
        <div class="actions">
          <button type="submit" [disabled]="busy() || configForm().submitting() || !unsaved()">
            {{ configForm().submitting() ? 'Saving…' : editing() ? 'Save changes' : 'Save preset' }}
          </button>
          @if (editing()) {
            <button
              type="button"
              [disabled]="busy() || configForm().submitting()"
              (click)="newPreset()"
            >
              New preset
            </button>
          }
        </div>
        <p role="status">
          {{
            configForm().submitting()
              ? 'Saving preset…'
              : unsaved()
                ? configForm().dirty()
                  ? 'Unsaved preset.'
                  : 'New preset. Not saved yet.'
                : 'Preset saved. No unsaved changes.'
          }}
        </p>
        @if (saveFailure()) {
          <p class="error" role="alert">{{ saveFailure() }}</p>
        }
        @for (e of configForm().errorSummary(); track $index) {
          <p class="error" role="alert">{{ e.message }}</p>
        }
      </form>
    </details>
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (data.hasValue()) {
      <section aria-labelledby="presets-heading">
        <h2 id="presets-heading">Saved presets</h2>
        @for (p of data.value()?.presets; track p.id) {
          <div class="row">
            <span
              ><strong>{{ p.config.name }}</strong> · {{ p.config.discoveryLimit }} jobs ·
              {{ p.config.materialLimit }} drafts · USD
              {{ p.config.costLimitUsd | number: '1.2-6' }}
              @if (p.config.intervalHours) {
                · every {{ p.config.intervalHours }} hours
              }
            </span>
            <div class="actions">
              <button
                type="button"
                (click)="edit(p)"
                [disabled]="busy() || configForm().submitting() || data.isLoading()"
              >
                Edit
              </button>
              <button
                type="button"
                (click)="act('/runs', { presetId: p.id }, 'start')"
                [disabled]="busy() || configForm().submitting() || data.isLoading() || hasActive()"
              >
                Start run
              </button>
            </div>
          </div>
        } @empty {
          <p>No presets saved yet. Saving one does not start a manual run.</p>
        }
      </section>
      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Recent runs</h2>
        @if (hasActive()) {
          <p role="status">A run is active. Wait or stop it before starting or resuming another.</p>
        }
        @for (r of data.value()?.runs; track r.id) {
          <article>
            <h3>{{ r.config.name }}</h3>
            <p>
              <span
                class="badge"
                [class.warning]="r.status === 'failed' || r.status === 'paused'"
                >{{ statusLabels[r.status] }}</span
              >
              · {{ r.createdAt | date: 'medium' }}
            </p>
            <p>
              {{ r.jobs.length }} / {{ r.config.discoveryLimit }} jobs · {{ r.materials }} /
              {{ r.config.materialLimit }} draft slots · {{ r.submissions }} /
              {{ r.config.submissionLimit }} submissions
            </p>
            <p>
              {{ r.requests }} / {{ r.config.requestLimit }} requests ·
              {{ r.elapsedSeconds | number: '1.0-0' }} / {{ r.config.timeLimitSeconds }} seconds ·
              USD {{ r.costUsd | number: '1.2-6' }} / {{ r.config.costLimitUsd | number: '1.2-6' }}
            </p>
            @if (r.message) {
              <p [class.warning]="r.status === 'failed' || r.status === 'paused'">
                {{ r.message }}
              </p>
            }
            <p class="hint">
              Recorded cost is an estimate, not a bill. Resuming keeps counts, costs and unknown
              reservations; an exhausted budget cannot be reset by resuming.
            </p>
            @if (r.status === 'paused' || r.status === 'failed') {
              <p class="hint">
                Stopping a run withdraws unused approvals. Resume with the same budget and approve
                each submission again. This preset’s schedule is paused; missed times are not
                replayed.
              </p>
            }
            <div class="actions">
              @if (r.status === 'paused' || r.status === 'failed') {
                <button
                  type="button"
                  [disabled]="
                    busy() || configForm().submitting() || data.isLoading() || hasActive()
                  "
                  (click)="act('/runs/' + r.id + '/resume', {}, 'resume')"
                >
                  Resume
                </button>
              } @else {
                <button
                  type="button"
                  [disabled]="busy() || configForm().submitting() || data.isLoading()"
                  (click)="act('/runs/' + r.id + '/stop', {}, 'stop')"
                >
                  Stop
                </button>
              }
            </div>
            <details>
              <summary>Captured settings and jobs</summary>
              <p>
                {{ r.sources.length }} source settings captured. These settings stay with this run
                when you change a preset, criteria or source. Repeat:
                {{ r.config.intervalHours ? 'every ' + r.config.intervalHours + ' hours' : 'off' }}.
              </p>
              <h4>Captured criteria</h4>
              <dl class="criteria-snapshot">
                <dt>Location</dt>
                <dd>
                  {{
                    r.criteria.location.area === 'custom'
                      ? r.criteria.location.places?.join(', ')
                      : areaLabels[r.criteria.location.area]
                  }}
                  · {{ strengthLabels[r.criteria.location.strength] }} ·
                  {{
                    r.criteria.location.area === 'worldwide' || r.criteria.location.includeRemote
                      ? 'Also remote jobs'
                      : 'No additional remote jobs'
                  }}
                  · Unknown when hard: {{ unknownLabels[r.criteria.location.ifUnknown] }}
                </dd>
                <dt>Title words</dt>
                <dd>
                  {{ r.criteria.title.words.join(', ') || 'None' }} ·
                  {{ strengthLabels[r.criteria.title.strength] }}
                </dd>
                <dt>Words to avoid</dt>
                <dd>
                  {{ r.criteria.avoidInTitle.words.join(', ') || 'None' }} ·
                  {{ strengthLabels[r.criteria.avoidInTitle.strength] }}
                </dd>
                <dt>Languages</dt>
                <dd>
                  {{ r.criteria.languages.languages.join(', ') || 'None' }} ·
                  {{ strengthLabels[r.criteria.languages.strength] }} · Unknown when hard:
                  {{ unknownLabels[r.criteria.languages.ifUnknown] }}
                </dd>
                <dt>Employment type</dt>
                <dd>
                  @for (type of r.criteria.employmentType.types; track type) {
                    {{ employmentLabels[type] }};
                  }
                  {{ strengthLabels[r.criteria.employmentType.strength] }} · Unknown when hard:
                  {{ unknownLabels[r.criteria.employmentType.ifUnknown] }}
                </dd>
                <dt>Must-haves</dt>
                <dd>
                  {{ strengthLabels[r.criteria.mustHaves.strength] }} · Unknown when hard:
                  {{ unknownLabels[r.criteria.mustHaves.ifUnknown] }}
                </dd>
              </dl>
              <h4>Captured sources</h4>
              <ul>
                @for (s of r.sources; track s.id) {
                  <li>
                    {{ s.catalogId }} {{ s.param }} ({{ s.enabled ? 'enabled' : 'disabled' }})
                  </li>
                }
              </ul>
              <h4>Jobs in this run</h4>
              <ul>
                @for (j of r.jobs; track j.id) {
                  <li>
                    <a [routerLink]="['/jobs', j.id]" [queryParams]="{ run: r.id }">{{
                      j.title
                    }}</a>
                    @if (j.message) {
                      <span> — {{ j.message }}</span>
                    }
                  </li>
                } @empty {
                  <li>No jobs admitted yet.</li>
                }
              </ul>
            </details>
          </article>
        } @empty {
          <p>No runs yet. Choose a saved preset to start.</p>
        }
      </section>
    } @else if (data.isLoading()) {
      <p role="status">Loading runs…</p>
    } @else {
      <p class="error" role="alert">{{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Retry loading</button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    p {
      max-width: 72ch;
    }
    h2 {
      margin-top: 1.5rem;
    }
    summary h2 {
      display: inline;
    }
    details {
      margin: 1.5rem 0;
    }
    form {
      margin-top: 1rem;
    }
    .field {
      display: grid;
      align-content: start;
      gap: 0.5rem;
      min-width: 0;
    }
    .field .hint {
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .run-help summary {
      cursor: pointer;
    }
    .name {
      max-width: 30rem;
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: 1rem;
      margin: 1rem 0;
    }
    input,
    button {
      font: inherit;
    }
    input {
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
    }
    .criteria-snapshot {
      max-width: 72ch;
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0 0 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.75rem 0;
    }
    article {
      padding: 1rem 0;
      border-top: 1px solid var(--line);
    }
    article h3 {
      margin: 0.25rem 0;
    }
    li {
      overflow-wrap: anywhere;
    }
  `,
})
export class Runs {
  private readonly http = inject(HttpClient);
  protected readonly data = httpResource<RunsResponse>(() => '/api/runs');
  protected readonly model = signal<RunConfig>({ ...defaults });
  protected readonly editing = signal('');
  private readonly savedConfig = signal<RunConfig | null>(null);
  protected readonly unsaved = computed(
    () => JSON.stringify(this.model()) !== JSON.stringify(this.savedConfig()),
  );
  protected readonly statusLabels: Record<Run['status'], string> = {
    queued: 'Queued',
    running: 'Running',
    paused: 'Stopped',
    ready: 'Preparation complete',
    failed: 'Failed',
  };
  protected readonly strengthLabels = { hard: 'Hard', preference: 'Preference', off: 'Off' };
  protected readonly unknownLabels = { to_confirm: 'To confirm', rule_out: 'Rule out' };
  protected readonly areaLabels = {
    helsinki: 'Helsinki and Espoo',
    finland: 'Finland',
    worldwide: 'Anywhere',
    custom: 'Selected locations',
  };
  protected readonly employmentLabels = employmentLabels;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly saveFailure = signal('');
  protected readonly message = signal('');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly hasActive = computed(
    () =>
      this.data.hasValue() &&
      this.data.value().runs.some((r) => r.status === 'running' || r.status === 'queued'),
  );
  protected readonly configForm = form(
    this.model,
    (s) => {
      required(s.name);
      maxLength(s.name, 100);
      const fields = [
        s.discoveryLimit,
        s.materialLimit,
        s.submissionLimit,
        s.requestLimit,
        s.timeLimitSeconds,
        s.intervalHours,
      ];
      const lower = [0, 0, 0, 1, 1, 0],
        upper = [500, 100, 5, 500, 3600, 168];
      fields.forEach((f, i) => {
        min(f, lower[i]!);
        max(f, upper[i]!);
        validate(f, ({ value }) =>
          Number.isInteger(value())
            ? undefined
            : { kind: 'integer', message: 'Use whole numbers for counts, time and hours.' },
        );
      });
      min(s.costLimitUsd, 0);
      max(s.costLimitUsd, 100);
    },
    {
      submission: {
        action: async () => {
          if (this.busy() || !this.unsaved()) return undefined;
          this.message.set('');
          this.saveFailure.set('');
          this.error.set('');
          try {
            const id = this.editing();
            const preset = await firstValueFrom(
              id
                ? this.http.put<RunPreset>('/api/run-presets/' + id, this.model())
                : this.http.post<RunPreset>('/api/run-presets', this.model()),
            );
            this.editing.set(preset.id);
            this.configForm().reset({ ...preset.config });
            this.savedConfig.set({ ...preset.config });
            this.message.set(
              preset.config.intervalHours
                ? 'Preset saved. Scheduled runs are enabled; each new run gets a new budget.'
                : 'Preset saved. Choose Start run when you are ready.',
            );
            this.data.reload();
          } catch (err) {
            this.saveFailure.set(errorMessage(err));
            return undefined;
          }
          return undefined;
        },
      },
    },
  );
  constructor() {
    const timer = setInterval(() => {
      if (!this.data.isLoading() && !this.busy() && !this.configForm().submitting())
        this.data.reload();
    }, 3000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
  protected edit(p: RunPreset) {
    this.saveFailure.set('');
    this.editing.set(p.id);
    this.configForm().reset({ ...p.config });
    this.savedConfig.set({ ...p.config });
    this.message.set('Editing ' + p.config.name);
  }
  protected newPreset() {
    this.saveFailure.set('');
    this.editing.set('');
    this.configForm().reset({ ...defaults });
    this.savedConfig.set(null);
    this.message.set('');
  }
  protected async act(path: string, body: object, action: 'start' | 'stop' | 'resume') {
    if (
      this.busy() ||
      this.configForm().submitting() ||
      this.data.isLoading() ||
      !this.data.hasValue()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    this.message.set(
      action === 'start'
        ? 'Starting run…'
        : action === 'stop'
          ? 'Stopping after the current step…'
          : 'Resuming run…',
    );
    try {
      await firstValueFrom(this.http.post('/api' + path, body));
      this.message.set(
        action === 'start'
          ? 'Run started with captured sources, criteria and limits.'
          : action === 'stop'
            ? 'Stop requested. Unused approvals are withdrawn; counts and cost reservations are retained.'
            : 'Resume requested with the same counts and budgets. Submissions need new approval.',
      );
      this.data.reload();
    } catch (err) {
      this.message.set('');
      this.error.set(errorMessage(err) + ' Check recent runs before trying again.');
      this.data.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
