import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Draft, DraftSection, DraftStatement } from '@jsa/shared';
import { usd } from '../jobs/jobs-api';
import { errorMessage } from '../sources/sources-api';
import { StatementReview } from './statement-review';

const sectionHeadings: Record<DraftSection, string> = {
  headline: 'Headline',
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
  languages: 'Languages',
  certifications: 'Certifications',
  letter: 'Letter',
};

const sectionOrder = Object.keys(sectionHeadings) as DraftSection[];

interface Block {
  /** A resume entry's title line; null for sentences of a headline, summary or letter paragraph. */
  title: DraftStatement | null;
  /** Bullets under the title, or the sentences. */
  lines: DraftStatement[];
}

interface Part {
  section: DraftSection;
  heading: string;
  blocks: Block[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One draft: the statements DeepSeek wrote, where each goes and what its checks found (T07), and
 * the user's review of them (T08). The finished document and its PDF are on the document page.
 */
@Component({
  selector: 'app-draft-page',
  imports: [DatePipe, RouterLink, StatementReview],
  template: `
    @if (data.hasValue()) {
      @let d = data.value();
      <div class="draft-layout">
        @if (parts().length) {
          <nav #outline class="outline" aria-label="Draft sections">
            <p class="outline-label">On this page</p>
            <div class="outline-links">
              <a
                href="#draft-overview"
                [attr.aria-current]="activeSection() === 'draft-overview' ? 'location' : null"
                (click)="jump($event, 'draft-overview')"
                >Overview</a
              >
              @for (part of parts(); track part.section) {
                <a
                  [href]="'#draft-' + part.section"
                  [attr.aria-current]="
                    activeSection() === 'draft-' + part.section ? 'location' : null
                  "
                  (click)="jump($event, 'draft-' + part.section)"
                  >{{ part.heading }}</a
                >
              }
            </div>
          </nav>
        }
        <div class="draft-content">
          <section #sectionTarget id="draft-overview" aria-labelledby="draft-heading">
            <p>
              <a [routerLink]="['/jobs', d.jobId]" queryParamsHandling="preserve"
                >Back to the job</a
              >
            </p>
            <h1 id="draft-heading" tabindex="-1">
              {{ d.kind === 'resume' ? 'Resume' : 'Cover letter' }} draft
            </h1>
            <p class="review-intro">
              Read every statement against its evidence before using the document.
            </p>
            <p>
              For {{ d.title }}{{ d.company ? ' at ' + d.company : '' }}. Written by
              {{ d.model }} on {{ d.createdAt | date: 'd MMM y, HH:mm' }} from
              {{ plural(d.factsSent, 'fact') }}, about {{ usd(d.costUsd) }}.
            </p>
            @if (d.outdated.length) {
              <p class="notice">
                {{ d.outdated.join(' ') }} You can write it again on the job page.
              </p>
            }
            <p class="review-counts">{{ counts() }}</p>
            <p class="notice">
              Passing deterministic checks does not prove that the meaning is correct. Inclusion is
              not a record of your review.
            </p>
            <details>
              <summary>What the checks do</summary>
              <p class="hint">
                The checks compare numbers, months, names and words such as “expected” or “basic”
                with the facts a statement cites, and leave out statements that cite nothing,
                contact details, permits, visas and salary. They do not judge meaning: read what is
                not your fact word for word against what it rests on. You can edit a statement,
                which is checked again the same way, and leave out one that passes. The app adds
                your name and contact details to the finished document.
              </p>
            </details>
            <p class="actions">
              <a
                class="button primary"
                [routerLink]="['/drafts', d.id, 'document']"
                queryParamsHandling="preserve"
                >See the finished document and save its PDF</a
              >
            </p>
            @if (!hasIncluded()) {
              <p class="notice">
                No statements are included. Review the evidence, correct failing wording, or put
                back statements that pass the checks.
              </p>
            }
          </section>
          @for (part of parts(); track part.section) {
            <section
              #sectionTarget
              [id]="'draft-' + part.section"
              [attr.aria-labelledby]="'heading-' + part.section"
            >
              <h2 [id]="'heading-' + part.section" tabindex="-1">{{ part.heading }}</h2>
              @for (block of part.blocks; track $index) {
                @if (part.section === 'letter') {
                  <h3>Paragraph {{ $index + 1 }}</h3>
                }
                @if (block.title; as t) {
                  <app-statement-review
                    [draftId]="d.id"
                    [statement]="t"
                    [entry]="true"
                    (changed)="data.set($event)"
                  />
                }
                @if (block.lines.length) {
                  <ul>
                    @for (s of block.lines; track s.id) {
                      <li>
                        <app-statement-review
                          [draftId]="d.id"
                          [statement]="s"
                          (changed)="data.set($event)"
                        />
                      </li>
                    }
                  </ul>
                }
              }
            </section>
          } @empty {
            <p>DeepSeek wrote no statements.</p>
          }
        </div>
      </div>
    } @else if (data.isLoading()) {
      <p role="status">Loading the draft…</p>
    } @else {
      <p><a routerLink="/jobs">All jobs</a></p>
      <p class="error" role="alert">The draft could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .draft-layout {
      display: grid;
      gap: 24px;
    }
    .draft-content {
      min-width: 0;
    }
    .outline {
      position: sticky;
      top: 0;
      z-index: 1;
      padding-block: 12px;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      min-width: 0;
      align-self: start;
    }
    .outline-label {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 14px;
    }
    .outline-links {
      display: flex;
      overflow-x: auto;
      gap: 4px;
      padding: 4px;
    }
    .outline a {
      display: flex;
      align-items: center;
      min-height: 44px;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--muted);
      text-decoration: none;
      white-space: nowrap;
    }
    .outline a[aria-current] {
      color: var(--action);
      background: var(--info-bg);
      font-weight: 650;
    }
    @media (hover: hover) and (pointer: fine) {
      .outline a:hover {
        color: var(--text);
        background: var(--layer);
      }
    }
    section {
      scroll-margin-top: 128px;
      display: flow-root;
    }
    @media (min-width: 1200px) {
      .draft-layout {
        grid-template-columns: minmax(0, 1fr) 168px;
        gap: 32px;
        align-items: start;
      }
      .outline {
        grid-column: 2;
        grid-row: 1;
        top: 32px;
        border: 0;
        border-left: 1px solid var(--line);
        padding: 0 0 0 16px;
        max-height: calc(100dvh - 64px);
        overflow-y: auto;
      }
      .outline-links {
        flex-direction: column;
        overflow: visible;
      }
      .draft-content {
        grid-column: 1;
        grid-row: 1;
      }
      section {
        scroll-margin-top: 32px;
      }
    }
    @media print {
      .outline {
        display: none;
      }
      .draft-layout {
        display: block;
      }
    }
    ul {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 1.5rem;
    }
    .review-intro {
      font-size: 18px;
    }
    .review-counts {
      font-weight: 600;
    }
    .notice {
      font-weight: 600;
    }
  `,
})
export class DraftPage {
  readonly id = input.required<string>();
  protected readonly activeSection = signal('draft-overview');
  private readonly outline = viewChild<ElementRef<HTMLElement>>('outline');
  private readonly targets = viewChildren<ElementRef<HTMLElement>>('sectionTarget');

  constructor() {
    afterRenderEffect((onCleanup) => {
      const targets = this.targets().map((target) => target.nativeElement);
      if (!targets.length || typeof IntersectionObserver === 'undefined') return;
      const visible = new Set<Element>();
      const document = targets[0]!.ownerDocument;
      const update = () => {
        const scroller = document.scrollingElement ?? document.documentElement;
        const atEnd =
          scroller.scrollTop > 0 &&
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        // Fractional scroll positions can leave a sliver of the preceding section visible.
        const current = atEnd
          ? targets.at(-1)
          : targets.find(
              (target) => visible.has(target) && target.getBoundingClientRect().bottom > 129,
            );
        if (current) this.activeSection.set(current.id);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          }
          update();
        },
        { rootMargin: '-128px 0px -50% 0px' },
      );
      targets.forEach((target) => observer.observe(target));
      document.addEventListener('scrollend', update);
      onCleanup(() => {
        observer.disconnect();
        document.removeEventListener('scrollend', update);
      });
    });
    afterRenderEffect(() => {
      const link = this.outline()?.nativeElement.querySelector<HTMLElement>(
        `a[href="#${this.activeSection()}"]`,
      );
      const strip = link?.parentElement;
      if (!link || !strip) return;
      const item = link.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      const left =
        item.left < bounds.left ? item.left - bounds.left : Math.max(0, item.right - bounds.right);
      if (left) strip.scrollBy({ left, behavior: 'instant' });
    });
  }

  protected jump(event: MouseEvent, id: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    const target = this.targets().find((target) => target.nativeElement.id === id)?.nativeElement;
    if (!target) return;
    event.preventDefault();
    this.activeSection.set(id);
    target.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior:
        event.detail > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'smooth'
          : 'instant',
      block: 'start',
    });
  }

  protected readonly data = httpResource<Draft>(() => `/api/drafts/${this.id()}`);
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly plural = plural;
  protected readonly usd = usd;
  protected readonly hasIncluded = computed(() =>
    this.data.value()?.statements.some((s) => s.inDocument),
  );

  protected readonly counts = computed(() => {
    const statements = this.data.value()?.statements ?? [];
    const kept = statements.filter((s) => s.inDocument);
    const failing = statements.filter((s) => s.problems.length > 0).length;
    const byYou = statements.filter((s) => !s.included && s.problems.length === 0).length;
    const reworded = kept.filter((s) => s.about === 'me' && !s.verbatim).length;
    const edited = statements.filter((s) => s.edited).length;
    return (
      `${plural(statements.length, 'statement')}: ${kept.length} in the document, ` +
      `${failing} left out by the checks` +
      (byYou ? `, ${byYou} left out by you` : '') +
      `. ${reworded} of those in the document ${reworded === 1 ? 'is' : 'are'} not your fact word for word` +
      (edited ? `; you edited ${plural(edited, 'statement')}.` : '.')
    );
  });

  /** The statements grouped by section and block, in document order. */
  protected readonly parts = computed((): Part[] => {
    const statements = this.data.value()?.statements ?? [];
    return sectionOrder
      .map((section) => {
        const blocks = new Map<number, Block>();
        for (const s of statements.filter((s) => s.section === section)) {
          const block = blocks.get(s.block) ?? { title: null, lines: [] };
          if (s.line === 'title') block.title = s;
          else block.lines.push(s);
          blocks.set(s.block, block);
        }
        return { section, heading: sectionHeadings[section], blocks: [...blocks.values()] };
      })
      .filter((part) => part.blocks.length > 0);
  });
}
