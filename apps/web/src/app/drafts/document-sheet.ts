import { Component, input } from '@angular/core';
import type { DocumentBlock, DraftKind } from '@jsa/shared';

/**
 * The finished document (T08) as an A4 sheet, the same on screen and in print. It renders the
 * server's blocks and adds no text of its own: an uploaded PDF must have exactly their text.
 * Nothing here may change how a text reads in the PDF, such as text-transform, letter-spacing or
 * automatic hyphens.
 */
@Component({
  selector: 'app-document-sheet',
  host: { '[class.letter]': "kind() === 'cover_letter'" },
  template: `
    @for (block of blocks(); track $index) {
      @switch (block.type) {
        @case ('name') {
          <p class="name">{{ block.text }}</p>
        }
        @case ('headline') {
          <p class="headline">{{ block.text }}</p>
        }
        @case ('contact') {
          <p class="contact">
            @for (item of block.items; track $index) {
              @if (!$first) {
                <span class="separator" aria-hidden="true">·</span>
              }
              @if (item.href) {
                <a [href]="item.href">{{ item.text }}</a>
              } @else {
                <span>{{ item.text }}</span>
              }
            }
          </p>
        }
        @case ('heading') {
          <h2>{{ block.text }}</h2>
        }
        @case ('paragraph') {
          <p>{{ block.text }}</p>
        }
        @case ('entry') {
          <p class="entry">{{ block.text }}</p>
        }
        @case ('bullets') {
          <ul>
            @for (item of block.items; track $index) {
              <li>{{ item }}</li>
            }
          </ul>
        }
        @case ('closing') {
          <p class="closing">
            @for (line of block.lines; track $index) {
              <span>{{ line }}</span>
            }
          </p>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 210mm;
      min-height: 297mm;
      margin: 1rem auto;
      padding: 16mm 18mm;
      background: #fff;
      color: #1a1a1a;
      color-scheme: light;
      box-shadow: 0 1px 6px rgb(0 0 0 / 30%);
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.4;
      font-variant-ligatures: none;
      hyphens: manual;
      overflow-wrap: anywhere;
    }
    p {
      margin: 0 0 6pt;
    }
    .name {
      font-size: 20pt;
      font-weight: 700;
      line-height: 1.2;
      margin: 0;
    }
    .headline {
      font-size: 12pt;
      margin: 2pt 0 0;
    }
    .contact {
      font-size: 9.5pt;
      color: #333;
      margin: 4pt 0 12pt;
    }
    .contact a {
      color: inherit;
      text-decoration: none;
    }
    .separator {
      margin: 0 0.5em;
      color: #888;
    }
    h2 {
      font-size: 11.5pt;
      font-weight: 700;
      margin: 12pt 0 5pt;
      padding-bottom: 2pt;
      border-bottom: 0.75pt solid #999;
      break-after: avoid;
    }
    .entry {
      font-weight: 600;
      margin: 7pt 0 2pt;
      break-after: avoid;
    }
    ul {
      margin: 0 0 4pt;
      padding-left: 14pt;
    }
    li {
      margin: 0 0 2pt;
      break-inside: avoid;
    }
    :host(.letter) p {
      margin-bottom: 10pt;
    }
    :host(.letter) .contact {
      margin-bottom: 24pt;
    }
    .closing span {
      display: block;
    }
    @media (max-width: 40rem) {
      :host {
        min-height: 0;
        padding: 1.25rem;
      }
    }
    @media print {
      :host {
        max-width: none;
        min-height: 0;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }
    }
  `,
})
export class DocumentSheet {
  readonly blocks = input.required<readonly DocumentBlock[]>();
  readonly kind = input.required<DraftKind>();
}
