import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { DocumentPdf, DraftDocument, PdfCheck } from '@jsa/shared';
import { DocumentPage } from './document-page';

const draftId = '00000000-0000-4000-8000-000000000001';
const url = `/api/drafts/${draftId}/document`;

const pdf: DocumentPdf = {
  id: '00000000-0000-4000-8000-000000000009',
  createdAt: '2026-10-06T08:00:00.000Z',
  fileName: 'Test Person - Resume - Example Pay - Payments Engineer.pdf',
  pages: 1,
  bytes: 40_960,
  sha256: 'a'.repeat(64),
  current: true,
};

/** Lets an answer reach the page: the code after an awaited request runs a task later. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

const resume = (fields: Partial<DraftDocument> = {}): DraftDocument => ({
  draftId,
  kind: 'resume',
  jobId: '00000000-0000-4000-8000-000000000002',
  title: 'Payments Engineer',
  company: 'Example Pay',
  fileName: 'Test Person - Resume - Example Pay - Payments Engineer',
  blocks: [
    { type: 'name', text: 'Test Person' },
    { type: 'headline', text: 'Backend developer' },
    {
      type: 'contact',
      items: [
        { text: 'test.person@example.com', href: 'mailto:test.person@example.com' },
        { text: 'Helsinki', href: null },
        { text: 'github.com/test-person', href: 'https://github.com/test-person' },
      ],
    },
    { type: 'paragraph', text: 'Builds invoice APIs in Go.' },
    { type: 'heading', text: 'Experience' },
    { type: 'entry', text: 'Backend developer, Acme Oy, 2021-03 – 2024-06' },
    { type: 'bullets', items: ['Built the invoice API in Go.', 'Ran the on-call rota.'] },
  ],
  missing: [],
  outdated: [],
  pdfs: [],
  ...fields,
});

describe('DocumentPage', () => {
  let fixture: ComponentFixture<DocumentPage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const sheet = () => page().querySelector('app-document-sheet')!;
  const fileInput = () => page().querySelector<HTMLInputElement>('input[type=file]')!;

  async function load(document: DraftDocument) {
    http.expectOne(url).flush(document);
    await fixture.whenStable();
  }

  async function choose(file: File) {
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DocumentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(DocumentPage);
    fixture.componentRef.setInput('id', draftId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows the document as the server built it, and nothing else on the sheet', async () => {
    await load(resume());
    expect(text(page().querySelector('h1'))).toBe('Resume for Payments Engineer at Example Pay');
    const lines = [...sheet().querySelectorAll('p, h2, li')].map((el) => text(el));
    expect(lines).toEqual([
      'Test Person',
      'Backend developer',
      // The separators are spaced by the style, not by text.
      'test.person@example.com·Helsinki·github.com/test-person',
      'Builds invoice APIs in Go.',
      'Experience',
      'Backend developer, Acme Oy, 2021-03 – 2024-06',
      'Built the invoice API in Go.',
      'Ran the on-call rota.',
    ]);
    const links = [...sheet().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['mailto:test.person@example.com', 'https://github.com/test-person']);
    // The browser suggests the title as the PDF's file name.
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Test Person - Resume - Example Pay - Payments Engineer',
    );
    expect(text()).toContain('None yet.');
  });

  it('shows a cover letter with its greeting and sign-off', async () => {
    await load(
      resume({
        kind: 'cover_letter',
        blocks: [
          { type: 'name', text: 'Test Person' },
          { type: 'paragraph', text: 'Dear Hiring Manager,' },
          { type: 'paragraph', text: 'I am applying for the Payments Engineer role.' },
          { type: 'closing', lines: ['Kind regards,', 'Test Person'] },
        ],
      }),
    );
    expect(text(page().querySelector('h1'))).toBe(
      'Cover letter for Payments Engineer at Example Pay',
    );
    expect(sheet().classList).toContain('letter');
    expect([...sheet().querySelectorAll('.closing span')].map((el) => text(el))).toEqual([
      'Kind regards,',
      'Test Person',
    ]);
  });

  it('prints with the browser', async () => {
    await load(resume());
    const print = vi
      .spyOn(TestBed.inject(DOCUMENT).defaultView!, 'print')
      .mockImplementation(() => {});
    [...page().querySelectorAll('button')].find((b) => text(b) === 'Print')!.click();
    expect(print).toHaveBeenCalled();
  });

  it('says what is missing before a PDF can be kept', async () => {
    await load(resume({ missing: ['Add your name on the Your details page.'] }));
    expect(text(page().querySelector('.notice'))).toBe('Add your name on the Your details page.');
    const details = [...page().querySelectorAll('a')].find((a) => text(a) === 'Your details')!;
    expect(details.getAttribute('href')).toBe('/profile');
    expect(fileInput().disabled).toBe(true);
  });

  it('uploads a PDF and lists it once the app kept it', async () => {
    await load(resume());
    const file = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });
    await choose(file);
    const request = http.expectOne(`/api/drafts/${draftId}/pdfs`);
    expect(request.request.body).toBe(file);
    expect(request.request.headers.get('content-type')).toBe('application/pdf');
    request.flush({ pdf, problems: [] } satisfies PdfCheck);
    await settle();
    expect(text(page().querySelector('[role=status]'))).toBe(
      'The app kept the PDF as “Test Person - Resume - Example Pay - Payments Engineer.pdf”.',
    );
    await load(resume({ pdfs: [pdf, { ...pdf, id: `${pdf.id.slice(0, -1)}8`, current: false }] }));
    const kept = [...page().querySelectorAll('.screen-only li')].slice(-2).map((li) => text(li));
    expect(kept[0]).toContain(`${pdf.fileName}, kept 6 Oct 2026`);
    expect(kept[0]).toContain('1 page, 40 KB. Its text is the document’s text.');
    expect(kept[1]).toContain('The document has changed since.');
    const download = [...page().querySelectorAll('a')].find((a) => text(a) === pdf.fileName)!;
    expect(download.getAttribute('href')).toBe(`/api/document-pdfs/${pdf.id}`);
  });

  it('says why the app did not keep a PDF', async () => {
    await load(resume());
    await choose(new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' }));
    const problems = [
      'The PDF has text that is not in the document: “06/10/2026, 14:02”.',
      '“Ran the on-call rota.” is not in the PDF, or reads differently there.',
    ];
    http.expectOne(`/api/drafts/${draftId}/pdfs`).flush({ pdf: null, problems });
    await settle();
    const alert = page().querySelector('[role=alert]')!;
    expect(text(alert.querySelector('p'))).toBe('The app did not keep this PDF:');
    expect([...alert.querySelectorAll('li')].map((li) => text(li))).toEqual(problems);
  });

  it('refuses a file larger than 2 MB without sending it, and shows a server refusal', async () => {
    await load(resume());
    await choose(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.pdf'));
    expect(text(page().querySelector('[role=alert] li'))).toBe('The PDF is larger than 2 MB.');

    await choose(new File(['<html>'], 'page.html'));
    http
      .expectOne(`/api/drafts/${draftId}/pdfs`)
      .flush({ message: 'This file is not a PDF.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(text(page().querySelector('[role=alert] li'))).toBe('This file is not a PDF.');
  });

  it('says when the document cannot be loaded', async () => {
    http
      .expectOne(url)
      .flush({ message: 'There is no such draft.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'The document could not be loaded. There is no such draft.',
    );
  });
});
