import { Component, input } from '@angular/core';
import type { DiffPart } from './word-diff';

/**
 * A word diff as text: removed words struck through, added ones underlined. Each part is an
 * element of its own, because the template drops the space around text between blocks.
 */
@Component({
  selector: 'app-diff-text',
  template: `
    <p>
      @for (part of parts(); track $index) {
        @switch (part.kind) {
          @case ('added') {
            <ins>{{ part.text }}</ins>
          }
          @case ('removed') {
            <del>{{ part.text }}</del>
          }
          @default {
            <span>{{ part.text }}</span>
          }
        }
      }
    </p>
    <p class="legend">Underlined: added. Struck through: left out.</p>
  `,
  styles: `
    p {
      margin: 0.25rem 0;
      white-space: pre-wrap;
    }
    ins {
      text-decoration: underline 2px;
      background: var(--info-bg);
    }
    del {
      background: var(--error-bg);
    }
    del + ins {
      margin-left: 0.25em;
    }
    .legend {
      font-size: 13px;
    }
  `,
})
export class DiffText {
  readonly parts = input.required<readonly DiffPart[]>();
}
