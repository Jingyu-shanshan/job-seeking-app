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
  styleUrl: './quick-guide.css',
  template: `
    @if (step(); as current) {
      <section aria-labelledby="guide-label" tabindex="-1" (keydown.escape)="close('skipped')">
        <header>
          <div>
            <h2 id="guide-label">A short guide to your workbench</h2>
            <p class="meta" id="guide-progress">
              Step {{ current.number }} of 3 · Go at your own pace.
            </p>
          </div>
          <button type="button" class="quiet" (click)="close('skipped')">Skip guide</button>
        </header>
        <div class="walkthrough">
          <ol aria-label="Guide steps">
            @for (item of steps; track item.number; let index = $index) {
              <li>
                <button
                  type="button"
                  [attr.aria-current]="item.number === current.number ? 'step' : null"
                  [attr.aria-label]="'Step ' + item.number + ': ' + item.label"
                  (click)="goTo(index)"
                >
                  <span class="step-number" aria-hidden="true">{{ item.number }}</span>
                  {{ item.label }}
                </button>
              </li>
            }
          </ol>
          <div class="instruction">
            <h3 id="guide-title" tabindex="-1" aria-describedby="guide-progress" #heading>
              {{ current.title }}
            </h3>
            <p>{{ current.text }}</p>
            <p class="hint">{{ current.note }}</p>
            <a class="button primary" [routerLink]="current.path">{{ current.link }}</a>
            <div class="step-controls">
              <button
                type="button"
                class="quiet"
                [disabled]="current.number === 1"
                (click)="previous()"
              >
                Previous
              </button>
              <button type="button" (click)="next()">
                {{ current.number === 3 ? 'Finish guide' : 'Continue' }}
              </button>
            </div>
          </div>
        </div>
        <footer class="hint">
          This guide does not save facts, call a model or submit an application. Reopen it anytime
          from Quick guide.
        </footer>
        @if (!state().remembered) {
          <p class="warning" role="status">
            Your browser could not remember this guide. You can keep using the app; the guide may
            appear again.
          </p>
        }
      </section>
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
  protected readonly steps = [
    {
      number: 1,
      label: 'Experience',
      title: 'Add your experience',
      text: 'Start with one fact about your experience, or import Markdown or a PDF with selectable text. Review and confirm what is accurate.',
      note: 'Confirmation and permissions are separate. Choose whether each fact may go to DeepSeek and appear in materials. Sensitive facts never go to DeepSeek.',
      path: '/facts',
      link: 'Open Facts to add your experience',
    },
    {
      number: 2,
      label: 'Job',
      title: 'Choose a job',
      text: 'Paste one original job description. Keep the requirements and responsibilities so you can review your fit and prepare materials for that role.',
      note: 'Adding a job does not send an application. Sources, criteria and automated discovery can be set up later.',
      path: '/jobs/paste',
      link: 'Paste a job',
    },
    {
      number: 3,
      label: 'Review',
      title: 'Review before sending',
      text: 'Open a saved job to prepare materials. Read every statement and its evidence, check the saved PDFs, then preview the actual form values and attachments.',
      note: 'Each application needs your separate approval before the runner submits it. Finishing this guide does not mark any materials as reviewed.',
      path: '/jobs',
      link: 'Open Jobs to review an application',
    },
  ];
  protected readonly step = computed(() => {
    const progress = this.state().progress;
    return typeof progress === 'number' ? this.steps[progress] : null;
  });
  readonly targetPath = computed(() => this.step()?.path.split('/').slice(0, 2).join('/') ?? null);

  reopen() {
    this.save(0);
    this.focusHeading();
  }

  protected goTo(index: number) {
    if (index !== 0 && index !== 1 && index !== 2) return;
    this.save(index);
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
