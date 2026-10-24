import { DatePipe } from '@angular/common';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { ToolCalls, ToolRequest, ToolResult } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { ToolsApi } from './tools-api';

@Component({
  selector: 'app-tools',
  imports: [DatePipe, FormField, FormRoot, RouterLink],
  template: `
    <h1>Web tools</h1>
    <p><a routerLink="/sources">Back to sources</a></p>
    <p>
      Manually search or read a public page with DeepSeek. Only the query or link you enter is sent.
      Keep personal details out. Results are saved here; they do not add jobs or change your
      materials.
    </p>
    @if (data.error()) {
      <p role="alert">{{ errorMessage(data.error()) }}</p>
      <button type="button" (click)="data.reload()">Reload saved calls</button>
    }
    @if (data.hasValue()) {
      <p id="tool-fee">
        Estimated fee: US$ {{ data.value().estimatedCostUsd }} per request. Empty results and
        confirmed failures cost zero. An unconfirmed outcome keeps this estimate. Model analysis is
        separate.
      </p>
      @if (!data.value().available) {
        <p role="alert">Set DEEPSEEK_API_KEY on the server to use these tools.</p>
      }
      <form [formRoot]="toolForm" [attr.aria-busy]="toolForm().submitting()">
        <fieldset [disabled]="toolForm().submitting() || !data.value().available || !!pending()">
          <label
            >Operation
            <select [formField]="toolForm.tool">
              <option value="search">Search</option>
              <option value="fetch">Read a page</option>
            </select>
          </label>
          <label
            >{{
              model().tool === 'search'
                ? 'Search query (up to 128 characters)'
                : 'Public https page link'
            }}
            <input
              [formField]="toolForm.input"
              aria-describedby="tool-fee tool-input-error"
              autocomplete="off"
            />
          </label>
          @if (toolForm.input().touched() && toolForm.input().invalid()) {
            <p role="alert" id="tool-input-error">{{ toolForm.input().errors()[0].message }}</p>
          }
          <button type="submit" class="primary">
            {{ toolForm().submitting() ? 'Requesting…' : 'Send paid request' }}
          </button>
        </fieldset>
      </form>
    }
    @if (failure()) {
      <p role="alert">{{ failure() }}</p>
    }
    @if (pending() && !toolForm().submitting()) {
      <p>The response was lost. Check this same request before starting another paid operation.</p>
      <button type="button" [disabled]="checking()" (click)="checkPending()">
        Retry / check same request
      </button>
    }
    <h2>Recent calls</h2>
    <button type="button" (click)="data.reload()">Refresh saved calls</button>
    @if (data.hasValue()) {
      @for (call of data.value().calls; track call.id) {
        <article>
          <h3>
            {{ call.tool === 'search' ? 'Search' : 'Page read' }} ·
            {{ call.createdAt | date: 'medium' }}
          </h3>
          <p>{{ call.input }}</p>
          <p>{{ call.message }}</p>
          <p>
            {{ call.estimated ? 'Estimated / reserved' : 'Recorded fee' }}: US$ {{ call.costUsd }}
          </p>
          @if (call.result) {
            <details>
              <summary>Saved result</summary>
              @if (searchResults(call.result); as results) {
                @for (result of results; track $index) {
                  <h4>{{ result.title }}</h4>
                  <p class="address">{{ result.url }}</p>
                  <p>{{ result.snippet }}</p>
                  <p>{{ result.summary }}</p>
                } @empty {
                  <p>No search results.</p>
                }
              }
              @if (pageContent(call.result); as page) {
                <h4>{{ page.title }}</h4>
                <pre>{{ page.content }}</pre>
              }
            </details>
          }
        </article>
      } @empty {
        <p>No requests yet. Opening this page does not contact DeepSeek.</p>
      }
    }
  `,
  styles: `
    .address {
      overflow-wrap: anywhere;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    article {
      border-top: 1px solid var(--line);
      padding-block: 16px;
    }
  `,
})
export class Tools {
  private readonly api = inject(ToolsApi);
  protected readonly errorMessage = errorMessage;
  protected readonly data = httpResource<ToolCalls>(() => '/api/tools');
  protected readonly model = signal<{ tool: ToolRequest['tool']; input: string }>({
    tool: 'search',
    input: '',
  });
  protected readonly failure = signal('');
  protected readonly pending = signal<ToolRequest | null>(null);
  protected readonly checking = signal(false);
  protected readonly toolForm = form(
    this.model,
    (s) => {
      required(s.input, { message: 'Enter a query or page link.' });
      maxLength(s.input, 2000, { message: 'Keep the input within 2000 characters.' });
    },
    {
      submission: {
        action: async () => {
          const request = {
            ...this.model(),
            id: crypto.randomUUID(),
            maxCostUsd: this.data.value()!.estimatedCostUsd,
          };
          this.pending.set(request);
          await this.send(request);
        },
      },
    },
  );

  protected searchResults(result: ToolResult) {
    return 'results' in result ? result.results : null;
  }
  protected pageContent(result: ToolResult) {
    return 'content' in result ? result : null;
  }

  private async send(request: ToolRequest) {
    this.failure.set('');
    try {
      await this.api.call(request);
      this.pending.set(null);
      this.data.reload();
    } catch (error) {
      this.failure.set(errorMessage(error));
      if (error instanceof HttpErrorResponse && [400, 409, 503].includes(error.status))
        this.pending.set(null);
    }
  }
  protected async checkPending() {
    const request = this.pending();
    if (!request || this.checking()) return;
    this.checking.set(true);
    try {
      await this.send(request);
    } finally {
      this.checking.set(false);
    }
  }
}
