import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, input } from '@angular/core';
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
      <p><a [routerLink]="['/jobs', d.jobId]">Back to the job</a></p>
      <h1>{{ d.kind === 'resume' ? 'Resume' : 'Cover letter' }} draft</h1>
      <p>
        For {{ d.title }}{{ d.company ? ' at ' + d.company : '' }}. Written by {{ d.model }} on
        {{ d.createdAt | date: 'd MMM y, HH:mm' }} from {{ plural(d.factsSent, 'fact') }}, about
        {{ usd(d.costUsd) }}.
      </p>
      @if (d.outdated.length) {
        <p class="notice">{{ d.outdated.join(' ') }} You can write it again on the job page.</p>
      }
      <p>{{ counts() }}</p>
      <p class="hint">
        The checks compare numbers, months, names and words such as “expected” or “basic” with the
        facts a statement cites, and leave out statements that cite nothing, contact details,
        permits, visas and salary. They do not judge meaning: read what is not your fact word for
        word against what it rests on. You can edit a statement, which is checked again the same
        way, and leave out one that passes. The app adds your name and contact details to the
        finished document.
      </p>
      <p>
        <a [routerLink]="['/drafts', d.id, 'document']"
          >See the finished document and save its PDF</a
        >
      </p>

      @for (part of parts(); track part.section) {
        <h2>{{ part.heading }}</h2>
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
      } @empty {
        <p>DeepSeek wrote no statements.</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading the draft…</p>
    } @else {
      <p><a routerLink="/jobs">All jobs</a></p>
      <p class="error" role="alert">The draft could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    ul {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 0.25rem;
    }
    .notice {
      font-weight: 600;
    }
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class DraftPage {
  readonly id = input.required<string>();

  protected readonly data = httpResource<Draft>(() => `/api/drafts/${this.id()}`);
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly plural = plural;
  protected readonly usd = usd;

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
