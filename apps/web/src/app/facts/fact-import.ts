import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormField,
  applyEach,
  disabled,
  form,
  maxLength,
  pattern,
  required,
} from '@angular/forms/signals';
import type {
  Fact,
  FactCandidate,
  FactDuplicate,
  PreviewFactsResponse,
  SaveFactCandidatesResponse,
} from '@jsa/shared';
import { factDuplicates, factSourceLabel } from '@jsa/shared/fact-import';
import {
  maxFactImportCandidates,
  maxFactImportTextLength,
  maxFactLength,
  maxPdfBytes,
} from '@jsa/shared/limits';
import { errorMessage } from '../sources/sources-api';
import { FactsApi, kindLabels } from './facts-api';

type ReviewCandidate = FactCandidate & {
  id: number;
  originalBody: string;
  originalKind: FactCandidate['kind'];
};

@Component({
  selector: 'app-fact-import',
  imports: [FormField],
  template: `
    <details>
      <summary><h2>Import PDF or Markdown</h2></summary>
      <p>
        Extract text, review each candidate, then add it to confirm. Nothing goes to DeepSeek.
        Importing does not confirm facts or turn on either permission. Original files are not kept.
      </p>
      @if (!preview()) {
        <label>
          PDF or Markdown file
          <input
            #file
            type="file"
            accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
            [disabled]="busy()"
            (change)="readFile(file)"
          />
        </label>
        <p>
          PDF: selectable text, at most 2 MiB and 20 pages. Markdown: at most 200,000 characters.
        </p>
        <label>
          Or paste Markdown
          <textarea rows="8" [formField]="pasteForm.markdown"></textarea>
        </label>
        <button type="button" [disabled]="busy() || pasteForm().invalid()" (click)="readMarkdown()">
          Preview Markdown
        </button>
      }
      <p role="status" tabindex="-1" #progress>
        @if (reading()) {
          Reading candidates…
        } @else if (saving()) {
          Adding candidates to confirm…
        } @else {
          {{ message() }}
        }
      </p>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
      @if (preview(); as preview) {
        @if (preview.pages.length) {
          <p>
            Columns and tables may read in the wrong order. Check the page text and correct, split
            or merge candidates before saving.
          </p>
          <details>
            <summary>Extracted page text ({{ preview.pages.length }} pages)</summary>
            @for (page of preview.pages; track page.page) {
              <h3>Page {{ page.page }}</h3>
              <pre>{{ page.text }}</pre>
            }
          </details>
        }
        <h3>Review candidates</h3>
        <p role="status">{{ counts() }}</p>
        <p>
          At most {{ maxCandidates }} candidates per import. Split at the text cursor. Merging keeps
          the first candidate’s category and selection; you can change both.
        </p>
        @for (candidate of review(); track candidate.id; let i = $index) {
          <fieldset [disabled]="busy()">
            <legend>Candidate {{ i + 1 }}</legend>
            <label
              ><input type="checkbox" [formField]="reviewForm[i].selected" />Keep candidate
              {{ i + 1 }}</label
            >
            <label>
              Kind
              <select [formField]="reviewForm[i].kind">
                @for (kind of kinds; track kind) {
                  <option [value]="kind">{{ kindLabels[kind] }}</option>
                }
              </select>
            </label>
            <label>Text<textarea #body rows="4" [formField]="reviewForm[i].body"></textarea></label>
            @if (candidate.selected && reviewForm[i].body().invalid()) {
              <p class="error" role="alert">{{ reviewForm[i].body().errors()[0].message }}</p>
            }
            <p class="source">{{ sourceLabel(candidate) }}</p>
            <details>
              <summary>Source fingerprint (SHA-256)</summary>
              <code>{{ candidate.source.sha256 }}</code>
            </details>
            @if (duplicates()[i]; as duplicate) {
              <p>
                {{
                  duplicate.status === 'retired'
                    ? 'Already exists in withdrawn facts. Importing will not restore it.'
                    : duplicate.status === 'batch'
                      ? 'Duplicates an earlier selected candidate. It will be skipped.'
                      : 'Already exists as a current fact. It will be skipped.'
                }}
              </p>
              @if (duplicate.factId) {
                <button type="button" (click)="viewFact.emit(duplicate.factId)">
                  {{
                    duplicate.status === 'retired'
                      ? 'View withdrawn fact / confirm again'
                      : 'View existing fact'
                  }}
                </button>
              }
            }
            <div class="actions">
              <button
                type="button"
                [disabled]="review().length >= maxCandidates"
                (click)="split(i, body.selectionStart)"
              >
                Split at cursor
              </button>
              <button type="button" [disabled]="i === review().length - 1" (click)="merge(i)">
                Merge with next
              </button>
            </div>
          </fieldset>
        }
        @if (totalTooLong()) {
          <p class="error" role="alert">Keep the reviewed text under 200,000 characters.</p>
        }
        <div class="actions">
          <button type="button" [disabled]="busy() || invalid()" (click)="save(progress)">
            Add selected to confirm
          </button>
          <button type="button" [disabled]="busy()" (click)="discard(progress)">
            Discard review / change file
          </button>
        </div>
        <p>
          Discarding only removes these unsaved candidates and edits; facts already saved are kept.
        </p>
      }
    </details>
  `,
  styles: `
    :host {
      display: block;
    }
    summary h2 {
      display: inline;
    }
    label {
      display: grid;
      gap: 0.25rem;
      margin: 0.5rem 0;
    }
    label:has(input[type='checkbox']) {
      display: flex;
      align-items: center;
      min-height: 2.75rem;
    }
    textarea,
    select,
    input[type='file'] {
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      font: inherit;
    }
    button,
    select,
    summary {
      min-height: 2.75rem;
    }
    summary {
      cursor: pointer;
      align-content: center;
    }
    fieldset {
      min-width: 0;
      margin: 1rem 0;
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: 0.5rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    pre {
      white-space: pre-wrap;
      font: inherit;
    }
    pre,
    code,
    .source {
      overflow-wrap: anywhere;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class FactImport {
  private readonly api = inject(FactsApi);
  private readonly progress = viewChild<ElementRef<HTMLElement>>('progress');
  readonly facts = input.required<Fact[]>();
  readonly saved = output<SaveFactCandidatesResponse>();
  readonly viewFact = output<string>();
  protected readonly kindLabels = kindLabels;
  protected readonly kinds = Object.keys(kindLabels) as Fact['kind'][];
  protected readonly maxCandidates = maxFactImportCandidates;
  protected readonly reading = signal(false);
  protected readonly saving = signal(false);
  protected readonly busy = computed(() => this.reading() || this.saving());
  protected readonly failure = signal('');
  protected readonly message = signal('');
  protected readonly preview = signal<PreviewFactsResponse | undefined>(undefined);
  protected readonly review = signal<ReviewCandidate[]>([]);
  private nextId = 0;
  private readonly originals = new Map<number, FactDuplicate | null>();
  private readonly paste = signal({ markdown: '' });
  protected readonly pasteForm = form(this.paste, (s) => {
    required(s.markdown);
    maxLength(s.markdown, maxFactImportTextLength);
    disabled(s.markdown, () => this.busy());
  });
  protected readonly reviewForm = form(this.review, (s) =>
    applyEach(s, (item) => {
      required(item.body, { message: 'Write the fact or leave this candidate out.' });
      pattern(item.body, /\S/, { message: 'Write the fact or leave this candidate out.' });
      maxLength(item.body, maxFactLength, {
        message: 'Split this fact or leave it out: at most 5000 characters per fact.',
      });
    }),
  );
  protected readonly duplicates = computed(() =>
    factDuplicates(this.review(), this.facts()).map(
      (d, i) =>
        d ??
        (this.review()[i]!.body === this.review()[i]!.originalBody &&
        this.originals.get(this.review()[i]!.id)?.status !== 'batch'
          ? (this.originals.get(this.review()[i]!.id) ?? null)
          : null),
    ),
  );
  protected readonly totalTooLong = computed(
    () => this.review().reduce((sum, c) => sum + c.body.length, 0) > maxFactImportTextLength,
  );
  protected readonly invalid = computed(
    () =>
      this.totalTooLong() ||
      this.review().some((c, i) => c.selected && this.reviewForm[i]!.body().invalid()),
  );
  protected readonly counts = computed(() => {
    const duplicates = this.duplicates().filter(Boolean).length;
    const selected = this.review().filter((c, i) => c.selected && !this.duplicates()[i]).length;
    return `${selected} selected · ${duplicates} duplicates to skip · ${this.review().length - selected - duplicates} left out`;
  });

  private candidates(): FactCandidate[] {
    return this.review().map((c) => ({
      kind: c.kind,
      body: c.body,
      selected: c.selected,
      source: {
        ...c.source,
        edited: c.source.edited || c.body !== c.originalBody || c.kind !== c.originalKind,
      },
    }));
  }

  protected sourceLabel(candidate: ReviewCandidate) {
    return factSourceLabel(
      JSON.stringify({
        ...candidate.source,
        edited:
          candidate.source.edited ||
          candidate.body !== candidate.originalBody ||
          candidate.kind !== candidate.originalKind,
      }),
    );
  }

  protected async readFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || this.busy()) return;
    await this.read(async () => {
      if (!file.size) throw new Error('The file is empty. Choose another file or paste Markdown.');
      if (file.size > maxPdfBytes) throw new Error('Use a file no larger than 2 MiB.');
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf')
        return this.api.previewPdf(file);
      const text = await file.text();
      return text.slice(0, 1024).includes('%PDF-')
        ? this.api.previewPdf(file)
        : this.api.previewMarkdown(text, file.name);
    });
    input.value = '';
  }

  protected async readMarkdown() {
    if (this.busy()) return;
    await this.read(() => this.api.previewMarkdown(this.paste().markdown));
  }

  private async read(load: () => Promise<PreviewFactsResponse>) {
    this.reading.set(true);
    this.failure.set('');
    this.message.set('');
    try {
      const preview = await load();
      this.originals.clear();
      this.review.set(
        preview.candidates.map((c) => {
          const id = this.nextId++;
          this.originals.set(id, c.duplicate);
          return {
            kind: c.kind,
            body: c.body,
            selected: c.selected,
            source: c.source,
            id,
            originalBody: c.body,
            originalKind: c.kind,
          };
        }),
      );
      this.preview.set(preview);
      this.message.set(
        'Candidates are ready to review. No candidates in this review have been saved.',
      );
      this.progress()?.nativeElement.focus();
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.reading.set(false);
    }
  }

  protected split(index: number, at: number) {
    const current = this.review()[index]!;
    if (!current.body.slice(0, at).trim() || !current.body.slice(at).trim()) {
      this.failure.set('Place the text cursor between two non-empty parts, then split.');
      return;
    }
    this.failure.set('');
    // A new row must not copy Angular's private form identity symbol from the original row.
    const parts = [
      { ...current, body: current.body.slice(0, at), source: { ...current.source, edited: true } },
      {
        id: this.nextId++,
        kind: current.kind,
        body: current.body.slice(at),
        selected: current.selected,
        source: { ...current.source, edited: true },
        originalBody: current.originalBody,
        originalKind: current.originalKind,
      },
    ];
    this.originals.delete(current.id);
    this.review.update((rows) => [...rows.slice(0, index), ...parts, ...rows.slice(index + 1)]);
  }

  protected merge(index: number) {
    const first = this.review()[index]!;
    const next = this.review()[index + 1]!;
    const source = { ...first.source, edited: true };
    if (source.type === 'pdf' && next.source.type === 'pdf')
      source.pages = [...new Set([...source.pages, ...next.source.pages])].sort((a, b) => a - b);
    this.originals.delete(first.id);
    this.originals.delete(next.id);
    this.review.update((rows) => [
      ...rows.slice(0, index),
      {
        ...first,
        body:
          first.body +
          (first.body.endsWith('\n') || next.body.startsWith('\n') ? '' : '\n') +
          next.body,
        source,
      },
      ...rows.slice(index + 2),
    ]);
    this.failure.set('');
  }

  protected discard(progress: HTMLElement) {
    this.review.set([]);
    this.preview.set(undefined);
    this.originals.clear();
    this.failure.set('');
    this.message.set(
      'Discarded the unsaved review. Saved facts were kept. Choose another file or paste Markdown.',
    );
    progress.focus();
  }

  protected async save(progress: HTMLElement) {
    if (this.busy() || this.invalid()) return;
    this.saving.set(true);
    this.failure.set('');
    try {
      const result = await this.api.saveCandidates(this.candidates());
      this.review.set([]);
      this.preview.set(undefined);
      this.originals.clear();
      this.message.set('');
      this.paste.set({ markdown: '' });
      this.saved.emit(result);
    } catch (error) {
      this.failure.set(errorMessage(error));
      progress.focus();
    } finally {
      this.saving.set(false);
    }
  }
}
