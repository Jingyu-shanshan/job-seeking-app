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
import type { RunConfig, RunPreset, RunsResponse } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';

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
    <details open>
      <summary>
        <h2>{{ editing() ? 'Edit preset' : 'New preset' }}</h2>
      </summary>
      <form [formRoot]="configForm">
        <label class="name">Preset name <input [formField]="configForm.name" /></label>
        <div class="fields">
          <label
            >Jobs to consider <input type="number" step="1" [formField]="configForm.discoveryLimit"
          /></label>
          <label
            >New drafts <input type="number" step="1" [formField]="configForm.materialLimit"
          /></label>
          <label
            >Approved submissions
            <input type="number" step="1" [formField]="configForm.submissionLimit"
          /></label>
          <label
            >External requests <input type="number" step="1" [formField]="configForm.requestLimit"
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
        <p>
          Each resume or cover letter counts as one draft. A failed draft keeps its slot for retry.
          Requests include board reads, job text, summaries, matches and drafts. Complete boards are
          saved; the job limit applies to jobs admitted to this run. Unknown locations stay in the
          group to confirm.
        </p>
        <p>
          Preparing drafts sends job text and the facts you allowed to DeepSeek outside the EU. The
          cost budget uses peak-price estimates. A request with unknown usage keeps its full
          reserved estimate, even after a timeout. Resuming keeps all counts and costs.
        </p>
        @if (model().intervalHours > 0) {
          <p>
            Repeating runs get a new budget each time while the server is online. A stopped or
            failed run pauses this preset’s schedule until you resume it. Missed times are not
            replayed.
          </p>
        }
        <div class="actions">
          <button type="submit" [disabled]="configForm().submitting()">
            {{ editing() ? 'Save changes' : 'Save preset' }}
          </button>
          @if (editing()) {
            <button type="button" (click)="newPreset()">New preset</button>
          }
        </div>
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
              <button type="button" (click)="edit(p)" [disabled]="busy()">Edit</button>
              <button
                type="button"
                (click)="act('/runs', { presetId: p.id })"
                [disabled]="busy() || hasActive()"
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
        @for (r of data.value()?.runs; track r.id) {
          <article>
            <h3>{{ r.config.name }} — {{ r.status }}</h3>
            <p>
              {{ r.createdAt | date: 'medium' }} · {{ r.jobs.length }} /
              {{ r.config.discoveryLimit }} jobs · {{ r.materials }} /
              {{ r.config.materialLimit }} draft slots · {{ r.submissions }} /
              {{ r.config.submissionLimit }} submissions
            </p>
            <p>
              {{ r.requests }} / {{ r.config.requestLimit }} requests ·
              {{ r.elapsedSeconds | number: '1.0-0' }} / {{ r.config.timeLimitSeconds }} seconds ·
              USD {{ r.costUsd | number: '1.2-6' }} / {{ r.config.costLimitUsd | number: '1.2-6' }}
            </p>
            <p>{{ r.message }}</p>
            <div class="actions">
              @if (r.status === 'paused' || r.status === 'failed') {
                <button
                  type="button"
                  [disabled]="busy() || hasActive()"
                  (click)="act('/runs/' + r.id + '/resume', {})"
                >
                  Resume
                </button>
              } @else {
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="act('/runs/' + r.id + '/stop', {})"
                >
                  Stop
                </button>
              }
            </div>
            <details>
              <summary>Captured settings and jobs</summary>
              <p>
                Location: {{ r.criteria.location.area }}. {{ r.sources.length }} source settings
                captured.
              </p>
              <ul>
                @for (s of r.sources; track s.id) {
                  <li>
                    {{ s.catalogId }} {{ s.param }} ({{ s.enabled ? 'enabled' : 'disabled' }})
                  </li>
                }
              </ul>
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
      max-width: 75ch;
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
      padding: 0.35rem;
      max-width: 100%;
    }
    button {
      padding: 0.35rem 0.65rem;
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
      border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    }
    article h3 {
      margin: 0.25rem 0;
    }
    li {
      overflow-wrap: anywhere;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Runs {
  private readonly http = inject(HttpClient);
  protected readonly data = httpResource<RunsResponse>(() => '/api/runs');
  protected readonly model = signal<RunConfig>({ ...defaults });
  protected readonly editing = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly hasActive = computed(
    () =>
      this.data.value()?.runs.some((r) => r.status === 'running' || r.status === 'queued') ?? false,
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
          try {
            const id = this.editing();
            await firstValueFrom(
              id
                ? this.http.put('/api/run-presets/' + id, this.model())
                : this.http.post('/api/run-presets', this.model()),
            );
            this.message.set('Preset saved. Each run uses its own captured settings.');
            this.data.reload();
          } catch (err) {
            return { kind: 'server', message: errorMessage(err) };
          }
          return undefined;
        },
      },
    },
  );
  constructor() {
    const timer = setInterval(() => {
      if (!this.data.isLoading()) this.data.reload();
    }, 3000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
  protected edit(p: RunPreset) {
    this.editing.set(p.id);
    this.model.set({ ...p.config });
    this.message.set('Editing ' + p.config.name);
  }
  protected newPreset() {
    this.editing.set('');
    this.model.set({ ...defaults });
  }
  protected async act(path: string, body: object) {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await firstValueFrom(this.http.post('/api' + path, body));
      this.data.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
