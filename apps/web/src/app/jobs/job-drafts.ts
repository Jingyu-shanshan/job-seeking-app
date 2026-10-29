import { DatePipe } from '@angular/common';
import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  DraftKind,
  DraftLanguage,
  DraftSummary,
  JobDetail,
  WriteDraftRequest,
} from '@jsa/shared';
import { draftLanguageNames } from '../drafts/draft-language';

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
      left out of the document. This is a paid request processed outside the EU; its cost is
      recorded afterwards.
    </p>
    <p>
      Read each statement and its evidence before using a draft. A check passing does not prove its
      meaning is correct. Set the name and contact details for your documents in
      <a routerLink="/profile">Your details</a>; those details are not sent to DeepSeek.
    </p>
    @if (job.factsToDraft === 0) {
      <p class="warning">
        None of your facts may be used yet. Confirm facts and allow them both to go to DeepSeek and
        to appear in documents on the <a routerLink="/facts">Facts</a> page.
      </p>
    }
    <p id="draft-language-help" class="hint">
      Choose the language for each document. Changing it creates a new paid draft; earlier drafts
      and PDFs are kept. The latest draft of each kind is used when preparing an application form.
    </p>
    <ul>
      @for (kind of kinds; track kind) {
        @let d = latest()[kind];
        <li>
          @if (d) {
            <a [routerLink]="['/drafts', d.id]" queryParamsHandling="preserve"
              >{{ capital(draftNames[kind]) }} draft</a
            >, written {{ d.createdAt | date: 'd MMM y, HH:mm' }}:
            {{ plural(d.statements, 'statement') }}, {{ d.rejected }} left out by the checks{{
              d.pdfs ? ', ' + plural(d.pdfs, 'PDF') + ' kept' : ''
            }}.
            <span class="hint">Written in {{ languageNames[d.language] }}.</span>
            @if (d.outdated.length) {
              <p class="warning">
                {{ d.outdated.join(' ') }} Review the current text and facts before using this
                draft.
              </p>
            }
          } @else {
            No {{ draftNames[kind] }} draft yet.
          }
          <div class="draft-actions">
            <div class="language-field">
              <label [for]="'draft-language-' + kind"
                >{{ capital(draftNames[kind]) }} language</label
              >
              <select
                #outputLanguage
                [id]="'draft-language-' + kind"
                [value]="language(kind)"
                [disabled]="busy() || job.factsToDraft === 0"
                aria-describedby="draft-language-help"
                (change)="selectLanguage(kind, outputLanguage.value)"
              >
                <option value="en" lang="en">English</option>
                <option value="zh" lang="zh">中文</option>
                <option value="fi" lang="fi">Suomi</option>
              </select>
            </div>
            @if (!d || d.outdated.length || d.language !== language(kind)) {
              <button
                type="button"
                [disabled]="busy() || job.factsToDraft === 0"
                (click)="write.emit({ kind, language: language(kind) })"
              >
                {{ d ? 'Write again' : 'Write a ' + draftNames[kind] }}
              </button>
            }
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    li {
      margin-bottom: 0.5rem;
    }
    .draft-actions {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }
    .language-field {
      display: grid;
      gap: 6px;
      min-width: 11rem;
    }
    label {
      margin: 0;
    }
    @media (max-width: 40rem) {
      .language-field {
        width: 100%;
      }
    }
    .hint {
      display: block;
      font-size: 14px;
    }
  `,
})
export class JobDrafts {
  readonly job = input.required<JobDetail>();
  /** Whether the page is waiting for a request, so nothing else may start. */
  readonly busy = input(false);
  /** The user asked for a draft of this kind. */
  readonly write = output<WriteDraftRequest>();

  protected readonly kinds: DraftKind[] = ['resume', 'cover_letter'];
  protected readonly draftNames = draftNames;
  protected readonly languageNames = draftLanguageNames;
  protected readonly plural = plural;
  protected readonly capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  protected readonly latest = computed(() => {
    const byKind: Partial<Record<DraftKind, DraftSummary>> = {};
    for (const d of this.job().snapshot?.drafts ?? []) byKind[d.kind] = d;
    return byKind;
  });

  private readonly selected = linkedSignal<
    string | undefined,
    Partial<Record<DraftKind, DraftLanguage>>
  >({
    source: () => this.job().snapshot?.id,
    computation: (id, previous) => (previous && previous.source === id ? previous.value : {}),
  });

  protected language(kind: DraftKind): DraftLanguage {
    return this.selected()[kind] ?? this.latest()[kind]?.language ?? 'en';
  }

  protected selectLanguage(kind: DraftKind, language: string) {
    if (language !== 'en' && language !== 'zh' && language !== 'fi') return;
    this.selected.update((selected) => ({ ...selected, [kind]: language }));
  }
}
