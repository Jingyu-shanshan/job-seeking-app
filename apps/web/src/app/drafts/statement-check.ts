import { Component, computed, input } from '@angular/core';
import type { DraftStatement } from '@jsa/shared';

/** What the checks found for one draft statement, and what it rests on. */
@Component({
  selector: 'app-statement-check',
  template: `
    @let s = statement();
    @if (s.problems.length) {
      <span class="left-out">Left out:</span>
      @for (p of s.problems; track p.message) {
        {{ p.message }}
      }
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
    </details>
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
  `,
})
export class StatementCheck {
  readonly statement = input.required<DraftStatement>();

  protected readonly passedLine = computed(() => {
    const s = this.statement();
    if (s.about === 'job') return 'About the job, checked against its quote.';
    if (s.about === 'other') return 'A connecting sentence: it states nothing to check.';
    return s.verbatim
      ? 'Your fact word for word.'
      : 'In DeepSeek’s words: read it against the facts it cites.';
  });
}
