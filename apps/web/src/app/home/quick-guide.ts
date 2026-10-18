import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Session } from '../auth/session';

type Progress = 0 | 1 | 2 | 'skipped' | 'completed';

@Component({
  selector: 'app-quick-guide',
  imports: [RouterLink],
  template: `
    @if (step(); as current) {
      <section aria-labelledby="guide-title">
        <h2 id="guide-title" tabindex="-1" #heading>A short guide to your workbench</h2>
        <p class="meta">
          Step {{ current.number }} of 3 · You can skip and return from Quick guide.
        </p>
        <h3>{{ current.title }}</h3>
        <p>{{ current.text }}</p>
        <p>
          <a [routerLink]="current.path">{{ current.link }}</a>
        </p>
        <div class="actions">
          <button type="button" [disabled]="current.number === 1" (click)="previous()">
            Previous
          </button>
          <button type="button" class="primary" (click)="next()">
            {{ current.number === 3 ? 'Finish guide' : 'Continue' }}
          </button>
          <button type="button" (click)="close('skipped')">Skip guide</button>
        </div>
        <p class="hint">This guide does not save facts, call a model or submit an application.</p>
        @if (!state().remembered) {
          <p class="warning" role="status">
            Your browser could not remember this guide. You can keep using the app; the guide may
            appear again.
          </p>
        }
      </section>
    }
  `,
  styles: `
    section {
      margin: 0 0 32px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }
    h2 {
      margin-top: 0;
    }
    @media (max-width: 600px) {
      section {
        padding: 16px;
      }
    }
    @media print {
      :host {
        display: none !important;
      }
    }
  `,
})
export class QuickGuide {
  readonly closed = output<void>();
  private readonly session = inject(Session);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly key = computed(() => `jsa:quick-guide:v1:${this.session.user()?.id}`);
  protected readonly state = linkedSignal(() => {
    const key = this.key();
    try {
      const stored: unknown = JSON.parse(
        this.document.defaultView!.localStorage.getItem(key) ?? '0',
      );
      const progress: Progress =
        stored === 0 ||
        stored === 1 ||
        stored === 2 ||
        stored === 'skipped' ||
        stored === 'completed'
          ? stored
          : 0;
      return { progress, remembered: true };
    } catch {
      return { progress: 0 as Progress, remembered: false };
    }
  });
  protected readonly step = computed(() => {
    const progress = this.state().progress;
    if (typeof progress !== 'number') return null;
    return [
      {
        number: 1,
        title: 'Add your experience',
        text: 'Type a fact, or import Markdown or a PDF with selectable text. New facts need your confirmation. Choose separately whether each may go to DeepSeek and whether it may appear in materials; sensitive facts never go to DeepSeek.',
        path: '/facts',
        link: 'Open Facts to add your experience',
      },
      {
        number: 2,
        title: 'Choose a job',
        text: 'Paste one original job description to get started. Sources, criteria and automated discovery can be set up later; you do not need them to add a job.',
        path: '/jobs/paste',
        link: 'Paste a job',
      },
      {
        number: 3,
        title: 'Review before sending',
        text: 'Read every statement and its evidence, check the saved PDFs, then preview the actual form values and attachments. Each application needs your separate approval before the runner submits it.',
        path: '/jobs',
        link: 'Open Jobs to review an application',
      },
    ][progress];
  });

  reopen() {
    this.save(0);
    this.focusHeading();
  }

  protected previous() {
    const progress = this.state().progress;
    if (progress === 1 || progress === 2) this.save(progress === 1 ? 0 : 1);
    this.focusHeading();
  }

  protected next() {
    const progress = this.state().progress;
    if (progress === 2) this.close('completed');
    else if (progress === 0 || progress === 1) {
      this.save(progress === 0 ? 1 : 2);
      this.focusHeading();
    }
  }

  protected close(progress: 'skipped' | 'completed') {
    this.save(progress);
    this.closed.emit();
  }

  private save(progress: Progress) {
    try {
      this.document.defaultView!.localStorage.setItem(this.key(), JSON.stringify(progress));
      this.state.set({ progress, remembered: true });
    } catch {
      this.state.set({ progress, remembered: false });
    }
  }

  private focusHeading() {
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }
}
