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
import { draftLanguageNames } from './draft-language';
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
        <p>
          <a [routerLink]="['/drafts', d.draftId]" queryParamsHandling="preserve"
            >Back to the draft</a
          >
        </p>
        <h1>{{ kindNames[d.kind] }} for {{ d.title }}{{ d.company ? ' at ' + d.company : '' }}</h1>
        <p>Document language: {{ languageNames[d.language] }}.</p>
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
            <button
              type="button"
              class="primary"
              [disabled]="busy() || d.missing.length > 0"
              (click)="print()"
            >
              Print
            </button>
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
            Select a non-empty PDF, at most 2 MiB. Selecting it starts verification. The app keeps
            it only if its text is exactly the document’s, with nothing missing, cut off or added.
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
            <p>
              Check the file and print the current document again if needed, with headers and
              footers off. Then select the PDF to retry.
            </p>
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
                <span class="tag" [class.todo]="!pdf.current">{{
                  pdf.current ? 'Current PDF' : 'Outdated PDF'
                }}</span>
                {{
                  pdf.current
                    ? 'Its text is the document’s text.'
                    : 'The document has changed since.'
                }}
              </li>
            }
          </ul>
        } @else {
          <p>
            None yet. Read and print the document, then upload the saved PDF here. Printing alone
            does not keep a file in the app.
          </p>
        }
        <p>
          <a [routerLink]="['/jobs', d.jobId]" queryParamsHandling="preserve"
            >Return to the job to review form answers and fill it in</a
          >
        </p>
        <h2>The document</h2>
      </div>
      <app-document-sheet [blocks]="d.blocks" [kind]="d.kind" [language]="d.language" />
    } @else if (data.isLoading()) {
      <p role="status">Loading the document…</p>
    } @else {
      <p><a routerLink="/jobs">All jobs</a></p>
      <p class="error" role="alert">The document could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
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
      app-root > .skip,
      app-quick-guide,
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
      color: var(--error-text);
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
  protected readonly languageNames = draftLanguageNames;
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
    this.status.set(
      'Print requested. Check the saved PDF yourself, then upload it here. The app cannot tell whether you saved a file.',
    );
  }

  protected async upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared, so that choosing the same file again uploads it again.
    input.value = '';
    if (!file || this.busy()) return;
    this.status.set('');
    this.problems.set([]);
    if (!file.size) {
      this.problems.set(['The PDF is empty. Select the saved PDF to try again.']);
      return;
    }
    if (file.size > maxPdfBytes) {
      this.problems.set([`The PDF is larger than ${maxPdfBytes / 1024 / 1024} MB.`]);
      return;
    }
    this.busy.set(true);
    this.status.set('Reading and comparing the PDF text…');
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
      if (this.problems().length) this.status.set('');
      this.busy.set(false);
    }
  }
}
