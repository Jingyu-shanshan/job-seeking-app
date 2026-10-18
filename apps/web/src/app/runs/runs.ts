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
    <p class="hint">
      The background run discovers jobs, reads descriptions, summarises, matches and writes drafts.
      It never fills forms, approves or submits them.
    </p>
    <details open>
      <summary>
        <h2>{{ editing() ? 'Edit preset' : 'New preset' }}</h2>
      </summary>
      <form [formRoot]="configForm">
        <fieldset class="form-fields" [disabled]="busy() || configForm().submitting()">
          <label class="name">Preset name <input [formField]="configForm.name" /></label>
          <div class="fields">
            <label
              >Jobs to consider
              <input type="number" step="1" [formField]="configForm.discoveryLimit"
            /></label>
            <label
              >New drafts <input type="number" step="1" [formField]="configForm.materialLimit"
            /></label>
            <label
              >Approved submissions
              <input type="number" step="1" [formField]="configForm.submissionLimit"
            /></label>
            <label
              >External requests
              <input type="number" step="1" [formField]="configForm.requestLimit"
            /></label>
            <label
              >Running time (seconds)
              <input type="number" step="1" [formField]="configForm.timeLimitSeconds"
            /></label>
            <label
              >Estimated cost limit (USD)
              <input type="number" step="0.01" [formField]="configForm.costLimitUsd"
            /></label>
            <label
              >Repeat every (hours; 0 is off)
              <input type="number" step="1" [formField]="configForm.intervalHours"
            /></label>
          </div>
        </fieldset>
        <p class="hint">
          Each resume or cover letter counts as one draft. A failed draft keeps its slot for retry.
          Requests include board reads, job text, summaries, matches and drafts. Complete boards are
          saved; the job limit applies to jobs admitted to this run. Unknown locations stay in the
          group to confirm.
        </p>
        <p class="notice">
          Preparing drafts sends job text and the facts you allowed to DeepSeek outside the EU. The
          cost budget uses peak-price estimates, not the provider’s bill. A request with unknown
          usage keeps its full reserved estimate, even after a timeout. Resuming keeps all counts
          and costs.
        </p>
        <p class="hint">
          Cost, drafts, submissions and repeat are off by default. Saving a preset with repeat off
          does not start a run; choose Start run separately.
        </p>
        @if (model().intervalHours > 0) {
          <p>
            Saving this preset enables a scheduled run every {{ model().intervalHours }} hours.
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
                  {{ areaLabels[r.criteria.location.area] }} ·
                  {{ strengthLabels[r.criteria.location.strength] }} ·
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
    label {
      display: grid;
      gap: 0.25rem;
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
