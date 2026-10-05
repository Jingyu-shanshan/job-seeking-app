import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Draft, DraftSection, DraftStatement } from '@jsa/shared';
import { usd } from '../jobs/jobs-api';
import { errorMessage } from '../sources/sources-api';
import { StatementCheck } from './statement-check';

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
  /** Entries that are one line each, such as skills or languages: shown as a plain list. */
  titlesOnly: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One draft (T07): the statements DeepSeek wrote, where each goes and what its checks found. */
@Component({
  selector: 'app-draft-page',
  imports: [DatePipe, RouterLink, StatementCheck],
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
        permits, visas and salary. They do not judge meaning: read what DeepSeek wrote in its own
        words. The app adds your name and contact details to the finished document.
      </p>
      <label>
        <input type="checkbox" [checked]="preview()" (change)="preview.set(!preview())" />
        Show only what goes into the document
      </label>

      @for (part of parts(); track part.section) {
        @if (preview()) {
          @switch (part.section) {
            @case ('headline') {
              <p class="headline">{{ texts(part.blocks[0]!.lines) }}</p>
            }
            @case ('letter') {
              @for (block of part.blocks; track $index) {
                <p>{{ texts(block.lines) }}</p>
              }
            }
            @case ('summary') {
              <h2>{{ part.heading }}</h2>
              <p>{{ texts(part.blocks[0]!.lines) }}</p>
            }
            @default {
              <h2>{{ part.heading }}</h2>
              @if (part.titlesOnly) {
                <ul>
                  @for (block of part.blocks; track $index) {
                    <li>{{ block.title!.text }}</li>
                  }
                </ul>
              }
              @for (block of part.titlesOnly ? [] : part.blocks; track $index) {
                @if (block.title) {
                  <p class="entry">{{ block.title.text }}</p>
                }
                @if (block.lines.length) {
                  <ul>
                    @for (s of block.lines; track s.id) {
                      <li>{{ s.text }}</li>
                    }
                  </ul>
                }
              }
            }
          }
        } @else {
          <h2>{{ part.heading }}</h2>
          @for (block of part.blocks; track $index) {
            @if (part.section === 'letter') {
              <h3>Paragraph {{ $index + 1 }}</h3>
            }
            @if (block.title; as t) {
              <p class="entry" [class.out]="t.problems.length">{{ t.text }}</p>
              <app-statement-check [statement]="t" />
            }
            @if (block.lines.length) {
              <ul>
                @for (s of block.lines; track s.id) {
                  <li>
                    <span [class.out]="s.problems.length">{{ s.text }}</span>
                    <app-statement-check [statement]="s" />
                  </li>
                }
              </ul>
            }
          }
        }
      } @empty {
        <p>No statement passed the checks, so the document would be empty.</p>
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
    .headline {
      font-size: 1.25rem;
      font-weight: 600;
    }
    .entry {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .out {
      text-decoration: line-through;
      opacity: 0.75;
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
  protected readonly preview = signal(false);
  protected readonly plural = plural;
  protected readonly usd = usd;

  protected readonly counts = computed(() => {
    const statements = this.data.value()?.statements ?? [];
    const kept = statements.filter((s) => s.problems.length === 0);
    const reworded = kept.filter((s) => s.about === 'me' && !s.verbatim).length;
    return (
      `${plural(statements.length, 'statement')}: ${kept.length} in the document, ` +
      `${statements.length - kept.length} left out. ` +
      `${reworded} of those in the document put your facts in DeepSeek’s words.`
    );
  });

  /** The statements grouped by section and block, in document order. */
  protected readonly parts = computed((): Part[] => {
    const statements = (this.data.value()?.statements ?? []).filter(
      (s) => !this.preview() || s.problems.length === 0,
    );
    return sectionOrder
      .map((section) => {
        const blocks = new Map<number, Block>();
        for (const s of statements.filter((s) => s.section === section)) {
          const block = blocks.get(s.block) ?? { title: null, lines: [] };
          if (s.line === 'title') block.title = s;
          else block.lines.push(s);
          blocks.set(s.block, block);
        }
        const all = [...blocks.values()];
        return {
          section,
          heading: sectionHeadings[section],
          blocks: all,
          titlesOnly: all.every((block) => block.title && block.lines.length === 0),
        };
      })
      .filter((part) => part.blocks.length > 0);
  });

  protected texts(statements: DraftStatement[]) {
    return statements.map((s) => s.text).join(' ');
  }
}
