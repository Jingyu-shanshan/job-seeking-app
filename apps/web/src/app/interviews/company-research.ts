import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import type { CompanyResearch, CompanyResearchRequest, CompanyResearchState } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';

@Component({
  selector: 'app-company-research',
  imports: [DatePipe, FormField],
  template: `
    <section aria-labelledby="research-heading" [attr.aria-busy]="busy()">
      <h2 id="research-heading">Company research</h2>
      <p>
        Search the official website for products or news. Only the company name, website host and
        selected topic go to DeepSeek outside the EU. Keep personal details out. This research is
        saved separately from your frozen application, practice and private notes.
      </p>
      @if (data.hasValue()) {
        @let state = data.value();
        <p id="research-fee">
          Each new version makes one paid search, up to US$ {{ state.estimatedCostUsd }}, and reads
          up to three public pages within 60 seconds. No paid Fetch or model analysis. Empty results
          and confirmed failures cost zero; unknown outcomes keep the estimate.
        </p>
        @if (!state.available) {
          <p class="notice">Set DEEPSEEK_API_KEY on the server before starting research.</p>
        }
        <fieldset [disabled]="busy() || !!pending() || !state.available">
          <legend>New research version</legend>
          <label
            >Company name <input [formField]="researchForm.company" autocomplete="off"
          /></label>
          <label
            >Official website origin
            <input
              [formField]="researchForm.website"
              type="url"
              placeholder="https://example.com"
              autocomplete="off"
          /></label>
          <label
            >Research topic
            <select [formField]="researchForm.topic">
              <option value="products">Products</option>
              <option value="news">Recent news</option>
            </select>
          </label>
          <button
            type="button"
            class="primary"
            (click)="start()"
            [disabled]="researchForm().invalid()"
            aria-describedby="research-fee"
          >
            Research company — new paid search
          </button>
        </fieldset>
        @if (pending()) {
          <p class="notice">
            Check this request before starting another search. Checking uses the same ID and cannot
            charge twice.
          </p>
          <button type="button" (click)="check()" [disabled]="busy()">Check saved request</button>
        }
        @if (busy()) {
          <p role="status">Researching the official website…</p>
        }
        @for (version of state.versions; track version.id) {
          <article>
            <h3>
              {{ version.company }} ·
              {{ version.topic === 'products' ? 'Products' : 'Recent news' }}
            </h3>
            <p class="hint">
              {{ version.createdAt | date: 'd MMM y, HH:mm' }} · Version {{ version.id }}
            </p>
            <p>{{ version.message }}</p>
            <p>
              {{ version.estimated ? 'Estimated fee retained' : 'Search fee' }}: US$
              {{ version.costUsd }}
            </p>
            <details>
              <summary>Search and reading evidence</summary>
              <p>{{ version.query }}</p>
              @for (source of version.sources; track source.url; let i = $index) {
                <h4>Source {{ i + 1 }} · {{ source.title || 'Official page' }}</h4>
                <p>
                  <a [href]="source.url" target="_blank" rel="noopener noreferrer">Original page</a>
                </p>
                <p>
                  <a [href]="source.finalUrl" target="_blank" rel="noopener noreferrer"
                    >Page read</a
                  >
                  · Public page · Read {{ source.readAt | date: 'd MMM y, HH:mm' }}
                </p>
                @if (source.truncated) {
                  <p>Excerpt limited to the first 20,000 characters.</p>
                }
                <blockquote>
                  <pre>{{ source.text }}</pre>
                </blockquote>
              } @empty {
                <p>No readable evidence. Products or recent developments remain unknown.</p>
              }
              @for (issue of version.issues; track $index) {
                <p class="notice">{{ issue }}</p>
              }
            </details>
          </article>
        } @empty {
          <p>No company research saved yet.</p>
        }
      } @else if (data.isLoading()) {
        <p role="status">Loading company research…</p>
      }
      @if (failure() || data.error()) {
        <p class="error" role="alert">
          {{ failure() || errorMessage(data.error()) }} Your inputs and earlier versions are kept.
        </p>
      }
      <button type="button" (click)="data.reload()" [disabled]="busy()">
        Refresh saved research
      </button>
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin-top: 32px;
    }
    fieldset {
      display: grid;
      gap: 16px;
      border: 1px solid var(--line);
    }
    label {
      display: grid;
      gap: 4px;
    }
    input,
    select,
    button {
      font: inherit;
      min-height: 2.75rem;
    }
    article {
      border-top: 1px solid var(--line);
      margin-top: 24px;
      padding-top: 16px;
    }
    .hint {
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: inherit;
    }
    blockquote {
      margin-inline: 0;
      border-left: 2px solid var(--line);
      padding-left: 16px;
    }
  `,
})
export class CompanyResearchPanel {
  readonly applicationId = input.required<string>();
  private readonly http = inject(HttpClient);
  protected readonly errorMessage = errorMessage;
  protected readonly data = httpResource<CompanyResearchState>(
    () => `/api/applications/${this.applicationId()}/company-research`,
  );
  private readonly model = linkedSignal({
    source: this.applicationId,
    computation: () => ({ company: '', website: '', topic: 'products' }),
  });
  protected readonly researchForm = form(this.model, (p) => {
    required(p.company);
    maxLength(p.company, 80);
    required(p.website);
    maxLength(p.website, 2000);
  });
  private readonly operation = linkedSignal<string, CompanyResearchRequest | null>({
    source: this.applicationId,
    computation: () => null,
  });
  protected readonly busy = computed(() => this.operation() !== null);
  protected readonly failure = linkedSignal({ source: this.applicationId, computation: () => '' });
  protected readonly pending = linkedSignal<string, CompanyResearchRequest | null>({
    source: this.applicationId,
    computation: () => null,
  });
  protected async start() {
    if (
      this.busy() ||
      this.pending() ||
      this.researchForm().invalid() ||
      !this.data.value()?.available
    )
      return;
    const values = this.model();
    this.pending.set({
      id: crypto.randomUUID(),
      company: values.company,
      website: values.website,
      topic: values.topic === 'news' ? 'news' : 'products',
      maxCostUsd: this.data.value()!.estimatedCostUsd,
    });
    await this.check();
  }
  protected async check() {
    const request = this.pending();
    if (this.busy() || !request) return;
    const id = this.applicationId();
    this.operation.set(request);
    this.failure.set('');
    try {
      const version = await firstValueFrom(
        this.http.post<CompanyResearch>(`/api/applications/${id}/company-research`, request),
      );
      if (this.operation() !== request) return;
      this.data.update((state) =>
        state
          ? {
              ...state,
              versions: [version, ...state.versions.filter((v) => v.id !== version.id)],
            }
          : state,
      );
      if (version.status !== 'pending') this.pending.set(null);
    } catch (error) {
      if (this.operation() !== request) return;
      this.failure.set(errorMessage(error));
      if (error instanceof HttpErrorResponse && [400, 401, 403, 404, 409].includes(error.status))
        this.pending.set(null);
    } finally {
      if (this.operation() === request) this.operation.set(null);
    }
  }
}
