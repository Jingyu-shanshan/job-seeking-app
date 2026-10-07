import { Component, computed, input } from '@angular/core';
import type { DraftStatement } from '@jsa/shared';
import { DiffText } from './diff-text';
import { changedWords, wordDiff } from './word-diff';

/** What the checks found for one draft statement, what it rests on and how it differs from it. */
@Component({
  selector: 'app-statement-check',
  imports: [DiffText],
  template: `
    @let s = statement();
    @if (s.problems.length) {
      <span class="left-out">Left out:</span>
      @for (p of s.problems; track p.message) {
        {{ p.message }}
      }
    } @else if (!s.included) {
      <span class="left-out">Left out by you.</span> It passes the checks; put it back to use it.
    } @else {
      <span class="tag">In the document</span> {{ passedLine() }}
    }
    <details>
      <summary>What it rests on</summary>
      @switch (s.about) {
        @case ('me') {
          @if (s.facts.length) {
            <ul>
              @for (f of s.facts; track f.versionId) {
                <li>
                  {{ f.body }}
                  <span class="hint">
                    (fact version {{ f.version
                    }}{{ f.current ? '' : ', changed since or no longer allowed in documents' }})
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p>None of your facts.</p>
          }
        }
        @case ('job') {
          @if (s.quote) {
            <p>The job text: “{{ s.quote }}”</p>
          } @else {
            <p>No quote from the job text.</p>
          }
        }
        @default {
          <p>Nothing: a connecting sentence may name only the job title and the company.</p>
        }
      }
      @if (fromSource(); as diff) {
        <p class="diff-label">{{ diff.label }}</p>
        <app-diff-text [parts]="diff.parts" />
      }
    </details>
    @if (s.edited) {
      <details>
        <summary>Your changes to DeepSeek’s text</summary>
        <app-diff-text [parts]="fromModel()" />
      </details>
    }
  `,
  styles: `
    :host {
      display: block;
      font-size: 0.9rem;
      margin: 0.125rem 0 0.5rem;
      padding-left: 0.5rem;
      border-left: 2px solid color-mix(in srgb, currentColor 30%, transparent);
    }
    .left-out {
      font-weight: 600;
      color: light-dark(#a3141c, #ff9b9b);
    }
    .tag {
      font-size: 0.8rem;
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
    }
    details p,
    details ul {
      margin: 0.25rem 0;
    }
    ul {
      padding-left: 1.25rem;
    }
    .diff-label {
      font-style: italic;
    }
  `,
})
export class StatementCheck {
  readonly statement = input.required<DraftStatement>();

  protected readonly passedLine = computed(() => {
    const s = this.statement();
    if (s.about === 'job') return 'About the job, checked against its quote.';
    if (s.about === 'other') return 'A connecting sentence: it states nothing to check.';
    if (s.verbatim) return 'Your fact word for word.';
    return s.edited
      ? 'In your words: read it against the facts it cites.'
      : 'In DeepSeek’s words: read it against the facts it cites.';
  });

  /** How the statement differs from its closest cited fact, or from its quote. */
  protected readonly fromSource = computed(() => {
    const s = this.statement();
    if (s.about === 'job' && s.quote) {
      return { label: 'How it differs from the quote:', parts: wordDiff(s.quote, s.text) };
    }
    if (s.about !== 'me' || s.facts.length === 0 || s.verbatim) return undefined;
    const closest = s.facts
      .map((f) => wordDiff(f.body, s.text))
      .reduce((best, parts) => (changedWords(parts) < changedWords(best) ? parts : best));
    const label =
      s.facts.length > 1
        ? 'How it differs from the fact it is closest to:'
        : 'How it differs from the fact:';
    return { label, parts: closest };
  });

  protected readonly fromModel = computed(() =>
    wordDiff(this.statement().modelText, this.statement().text),
  );
}
