import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { JobDetail, ModelUsage } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobSummaryView } from './job-summary';
import { JobsApi, usd } from './jobs-api';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * 一个职位（T05）：读取或查看原文，用 DeepSeek 总结，查看和更正总结里的要求。
 * 每次总结是用户点击触发的一次模型请求，请求里只有职位原文。
 */
@Component({
  selector: 'app-job-detail',
  imports: [DatePipe, JobSummaryView, RouterLink],
  template: `
    <p><a routerLink="/jobs">All jobs</a></p>
    @if (data.hasValue()) {
      @let job = data.value();
      <h1>{{ job.title }}</h1>
      <p>
        {{ job.company ?? job.sources[0]?.param ?? 'Company not given' }} ·
        {{ job.location || 'No location given' }} ·
        <a [href]="job.url" target="_blank" rel="noopener noreferrer">Job page</a>
      </p>
      <p>{{ listing() }}</p>

      <section aria-labelledby="text-heading">
        <h2 id="text-heading">Job text</h2>
        @if (job.snapshot; as snapshot) {
          <p>
            {{ snapshot.catalogId === 'paste' ? 'Pasted' : 'Read from the job board' }}
            {{ snapshot.capturedAt | date: 'd MMM y' }}.
            @if (job.earlierSnapshots) {
              {{ plural(job.earlierSnapshots, 'earlier version') }} kept.
            }
          </p>
          @if (job.canImport) {
            <button type="button" [disabled]="busy()" (click)="importText()">
              Check for a newer version
            </button>
          }
          <details>
            <summary>Show the job text</summary>
            <pre class="jd">{{ snapshot.text }}</pre>
          </details>
        } @else if (job.canImport) {
          <p>The job text has not been read yet.</p>
          <button type="button" [disabled]="busy()" (click)="importText()">
            Read the job text
          </button>
        } @else {
          <p>None of the sources you use lists this job now, so the app cannot read its text.</p>
        }
      </section>

      @if (job.snapshot; as snapshot) {
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading">Summary</h2>
          @if (snapshot.summary) {
            <app-job-summary [snapshot]="snapshot" (changed)="data.set($event)" />
          } @else {
            <p>
              Summarising sends the job text, and nothing about you, to DeepSeek in one request.
              Every point of the summary quotes the job text.
            </p>
            <button type="button" [disabled]="busy()" (click)="summarise()">
              Summarise with DeepSeek
            </button>
            @if (usage.hasValue()) {
              <p class="hint">{{ usageLine() }}</p>
            }
          }
        </section>
      }

      <p role="status">{{ status() }}</p>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading the job…</p>
    } @else {
      <p class="error" role="alert">The job could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    .jd {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: inherit;
    }
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class JobDetailPage {
  private readonly api = inject(JobsApi);

  /** 路由参数里的职位 ID。 */
  readonly id = input.required<string>();

  protected readonly data = httpResource<JobDetail>(() => `/api/jobs/${this.id()}`);
  protected readonly usage = httpResource<ModelUsage>(() => '/api/model-usage');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly failure = signal('');
  protected readonly plural = plural;

  protected readonly listing = computed(() => {
    const job = this.data.value();
    if (!job) return '';
    if (job.sources.length) {
      return `Listed by ${job.sources.map((s) => s.param).join(', ')}.`;
    }
    return job.snapshot?.catalogId === 'paste'
      ? 'You pasted this job.'
      : 'No source you use lists this job now.';
  });

  protected readonly usageLine = computed(() => {
    const u = this.usage.value();
    if (!u) return '';
    return `DeepSeek use so far: ${plural(u.calls, 'request')}, ${u.failed} failed, about ${usd(u.costUsd)}.`;
  });

  protected importText() {
    return this.run('Reading the job text from the job board…', () =>
      this.api.importText(this.id()),
    );
  }

  protected async summarise() {
    const snapshot = this.data.value()?.snapshot;
    if (!snapshot) return;
    await this.run('Summarising with DeepSeek. This can take a minute.', () =>
      this.api.summarise(snapshot.id),
    );
    // 成功或失败都记了一次调用。
    this.usage.reload();
  }

  private async run(working: string, change: () => Promise<JobDetail>) {
    this.busy.set(true);
    this.failure.set('');
    this.status.set(working);
    try {
      this.data.set(await change());
      this.status.set('');
    } catch (error) {
      this.status.set('');
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
