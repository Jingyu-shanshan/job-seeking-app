import { DOCUMENT, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { DraftDocument, DraftKind } from '@jsa/shared';
import { maxPdfBytes } from '@jsa/shared/limits';
import { errorMessage } from '../sources/sources-api';
import { DocumentSheet } from './document-sheet';
import { DraftsApi } from './drafts-api';

const kindNames: Record<DraftKind, string> = { resume: 'Resume', cover_letter: 'Cover letter' };

/**
 * A draft's finished document (T08): printed to PDF by the browser and uploaded, the app keeps the
 * PDF when its text is the document's. Its styles are global while it is shown, because printing
 * must hide the app's header and set the page; every rule but those is scoped to this page.
 */
@Component({
  selector: 'app-document-page',
  encapsulation: ViewEncapsulation.None,
  imports: [DatePipe, DocumentSheet, RouterLink],
  template: `
    @if (data.hasValue()) {
      @let d = data.value();
      <div class="screen-only">
        <p><a [routerLink]="['/drafts', d.draftId]">Back to the draft</a></p>
        <h1>{{ kindNames[d.kind] }} for {{ d.title }}{{ d.company ? ' at ' + d.company : '' }}</h1>
        @if (d.outdated.length) {
          <p class="notice">{{ d.outdated.join(' ') }}</p>
        }
        @if (d.missing.length) {
          <p class="notice">{{ d.missing.join(' ') }}</p>
        }
        <ol>
          <li>
            Read the document below. To change a statement, go back to the draft; for your name and
            contact details, go to <a routerLink="/profile">Your details</a>.
          </li>
          <li>
            <button type="button" (click)="print()">Print</button>
            and choose “Save as PDF”. The page sets its size (A4) and margins and keeps the
            browser’s date, address and page numbers off the page; if the print preview shows them,
            turn off “Headers and footers”. The suggested file name is “{{ d.fileName }}.pdf”.
          </li>
          <li>
            <label>
              Upload the PDF
              <input
                #file
                type="file"
                accept="application/pdf,.pdf"
                [disabled]="busy() || d.missing.length > 0"
                (change)="upload(file)"
              />
            </label>
            The app keeps it only if its text is exactly the document’s, with nothing missing, cut
            off or added.
          </li>
        </ol>
        <p role="status">{{ status() }}</p>
        @if (problems().length) {
          <div class="problems" role="alert">
            <p>The app did not keep this PDF:</p>
            <ul>
              @for (p of problems(); track $index) {
                <li>{{ p }}</li>
              }
            </ul>
          </div>
        }

        <h2>PDFs the app kept</h2>
        @if (d.pdfs.length) {
          <ul>
            @for (pdf of d.pdfs; track pdf.id) {
              <li>
                <a [href]="'/api/document-pdfs/' + pdf.id">{{ pdf.fileName }}</a
                >, kept {{ pdf.createdAt | date: 'd MMM y, HH:mm' }}: {{ pages(pdf.pages) }},
                {{ size(pdf.bytes) }}.
                {{
                  pdf.current
                    ? 'Its text is the document’s text.'
                    : 'The document has changed since.'
                }}
              </li>
            }
          </ul>
        } @else {
          <p>None yet.</p>
        }
        <h2>The document</h2>
      </div>
      <app-document-sheet [blocks]="d.blocks" [kind]="d.kind" />
    } @else if (data.isLoading()) {
      <p role="status">Loading the document…</p>
    } @else {
      <p><a routerLink="/jobs">All jobs</a></p>
      <p class="error" role="alert">The document could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    @page {
      size: A4;
      margin: 16mm 18mm;
      /* Defining every margin box keeps the browser's own date, title, address and page
         numbers off the page. */
      @top-left {
        content: '';
      }
      @top-center {
        content: '';
      }
      @top-right {
        content: '';
      }
      @bottom-left {
        content: '';
      }
      @bottom-center {
        content: '';
      }
      @bottom-right {
        content: '';
      }
    }
    @media print {
      app-root > header,
      app-document-page .screen-only {
        display: none !important;
      }
      app-root > main {
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    }
    app-document-page {
      display: block;
    }
    app-document-page .notice {
      font-weight: 600;
    }
    app-document-page li {
      margin-bottom: 0.5rem;
    }
    app-document-page .problems,
    app-document-page .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class DocumentPage {
  private readonly api = inject(DraftsApi);
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);

  readonly id = input.required<string>();

  protected readonly data = httpResource<DraftDocument>(() => `/api/drafts/${this.id()}/document`);
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly kindNames = kindNames;
  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly problems = signal<string[]>([]);

  constructor() {
    // The browser suggests the page's title as the PDF's file name.
    effect(() => {
      if (this.data.hasValue()) this.title.setTitle(this.data.value().fileName);
    });
  }

  protected pages(n: number) {
    return `${n} page${n === 1 ? '' : 's'}`;
  }

  protected size(bytes: number) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected print() {
    this.document.defaultView?.print();
  }

  protected async upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared, so that choosing the same file again uploads it again.
    input.value = '';
    if (!file) return;
    this.status.set('');
    this.problems.set([]);
    if (file.size > maxPdfBytes) {
      this.problems.set([`The PDF is larger than ${maxPdfBytes / 1024 / 1024} MB.`]);
      return;
    }
    this.busy.set(true);
    try {
      const result = await this.api.uploadPdf(this.id(), file);
      if (result.pdf) {
        this.status.set(`The app kept the PDF as “${result.pdf.fileName}”.`);
        this.data.reload();
      } else {
        this.problems.set(result.problems);
      }
    } catch (error) {
      this.problems.set([errorMessage(error)]);
    } finally {
      this.busy.set(false);
    }
  }
}
