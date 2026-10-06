import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DraftKind, DraftSummary, JobDetail } from '@jsa/shared';

export const draftNames: Record<DraftKind, string> = {
  resume: 'resume',
  cover_letter: 'cover letter',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The job page's drafts: the latest resume and cover letter, and writing them (T07). */
@Component({
  selector: 'app-job-drafts',
  imports: [DatePipe, RouterLink],
  template: `
    @let job = this.job();
    <p>
      Writing a draft sends this job’s text and the {{ plural(job.factsToDraft, 'fact') }} you
      allowed both to go to DeepSeek and to appear in documents, in one request; nothing else about
      you, and no name or contact details. Every statement must cite your facts or quote the job
      text, and the app checks its numbers, dates and names against them: a statement that fails is
      left out of the document.
    </p>
    @if (job.factsToDraft === 0) {
      <p>
        None of your facts may be used yet. Confirm facts and allow them both to go to DeepSeek and
        to appear in documents on the <a routerLink="/facts">Facts</a> page.
      </p>
    }
    <ul>
      @for (kind of kinds; track kind) {
        @let d = latest()[kind];
        <li>
          @if (d) {
            <a [routerLink]="['/drafts', d.id]">{{ capital(draftNames[kind]) }} draft</a>, written
            {{ d.createdAt | date: 'd MMM y, HH:mm' }}: {{ plural(d.statements, 'statement') }},
            {{ d.rejected }} left out by the checks{{
              d.pdfs ? ', ' + plural(d.pdfs, 'PDF') + ' kept' : ''
            }}.
            @if (d.outdated.length) {
              <span class="hint">{{ d.outdated.join(' ') }}</span>
            }
          } @else {
            No {{ draftNames[kind] }} draft yet.
          }
          @if (!d || d.outdated.length) {
            <button
              type="button"
              [disabled]="busy() || job.factsToDraft === 0"
              (click)="write.emit(kind)"
            >
              {{ d ? 'Write again' : 'Write a ' + draftNames[kind] }}
            </button>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    li {
      margin-bottom: 0.5rem;
    }
    button {
      margin-left: 0.5rem;
    }
    .hint {
      display: block;
      font-size: 0.9rem;
    }
  `,
})
export class JobDrafts {
  readonly job = input.required<JobDetail>();
  /** Whether the page is waiting for a request, so nothing else may start. */
  readonly busy = input(false);
  /** The user asked for a draft of this kind. */
  readonly write = output<DraftKind>();

  protected readonly kinds: DraftKind[] = ['resume', 'cover_letter'];
  protected readonly draftNames = draftNames;
  protected readonly plural = plural;
  protected readonly capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  protected readonly latest = computed(() => {
    const byKind: Partial<Record<DraftKind, DraftSummary>> = {};
    for (const d of this.job().snapshot?.drafts ?? []) byKind[d.kind] = d;
    return byKind;
  });
}
