import Type, { type Static } from 'typebox';
import { DraftKindSchema } from './drafts.ts';

/**
 * One block of a finished document, in order (T08). The server builds the blocks from the
 * statements in the document and the user's details, and checks an uploaded PDF against their
 * text, so the page must render every text exactly as given and add none of its own.
 */
export const DocumentBlockSchema = Type.Union([
  Type.Object({ type: Type.Literal('name'), text: Type.String() }),
  Type.Object({ type: Type.Literal('headline'), text: Type.String() }),
  Type.Object({
    type: Type.Literal('contact'),
    /** Shown on one line; `href` is a mailto: or https link, or null for plain text. */
    items: Type.Array(
      Type.Object({ text: Type.String(), href: Type.Union([Type.String(), Type.Null()]) }),
    ),
  }),
  Type.Object({ type: Type.Literal('heading'), text: Type.String() }),
  Type.Object({ type: Type.Literal('paragraph'), text: Type.String() }),
  /** A resume entry's title line. */
  Type.Object({ type: Type.Literal('entry'), text: Type.String() }),
  Type.Object({ type: Type.Literal('bullets'), items: Type.Array(Type.String()) }),
  /** A letter's sign-off: lines without space between them. */
  Type.Object({ type: Type.Literal('closing'), lines: Type.Array(Type.String()) }),
]);

export type DocumentBlock = Static<typeof DocumentBlockSchema>;

/** A PDF of a draft the app kept, because its text was the document's text. */
export const DocumentPdfSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  fileName: Type.String(),
  pages: Type.Integer({ minimum: 1 }),
  bytes: Type.Integer({ minimum: 1 }),
  sha256: Type.String(),
  /** Its text is still the document's text: nothing was edited, left out or changed since. */
  current: Type.Boolean(),
});

export type DocumentPdf = Static<typeof DocumentPdfSchema>;

/** A draft as the finished document, and the PDFs of it the app kept. */
export const DraftDocumentSchema = Type.Object({
  draftId: Type.String({ format: 'uuid' }),
  kind: DraftKindSchema,
  jobId: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  /** A file name for the PDF, without `.pdf`; also the print page's title. */
  fileName: Type.String(),
  blocks: Type.Array(DocumentBlockSchema),
  /** Why no PDF of it can be kept yet, such as a missing name; empty when one can. */
  missing: Type.Array(Type.String()),
  outdated: Type.Array(Type.String()),
  pdfs: Type.Array(DocumentPdfSchema),
});

export type DraftDocument = Static<typeof DraftDocumentSchema>;

export const maxPdfBytes = 2 * 1024 * 1024;

/** What became of an uploaded PDF: kept (`pdf`), or the reasons it was not. */
export const PdfCheckSchema = Type.Object({
  pdf: Type.Union([DocumentPdfSchema, Type.Null()]),
  problems: Type.Array(Type.String()),
});

export type PdfCheck = Static<typeof PdfCheckSchema>;
