import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  DraftDocumentSchema,
  PdfCheckSchema,
  maxPdfBytes,
  type DocumentPdf,
  type DraftDocument,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { loadDraftState } from '../drafts/load.ts';
import { httpError } from '../http-error.ts';
import { loadFactState } from '../matching/check.ts';
import { loadProfile } from '../profile/routes.ts';
import {
  documentBlocks,
  documentFileName,
  documentMissing,
  documentPieces,
} from '../rules/document.ts';
import { pdfTextProblems } from '../rules/pdf.ts';
import { looksLikePdf, readPdf } from './pdf.ts';

// The finished document of a draft and the PDFs of it (T08). The user prints the document page
// to PDF in the browser and uploads the file; the app keeps it only if its text is the document's
// text as it is now (rules/pdf.ts), with the statement versions it was built from.

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

interface PdfRow {
  id: string;
  created_at: Date;
  file_name: string;
  pages: number;
  bytes: number;
  body_sha256: string;
  text: string;
}

const pdfColumns =
  'id, created_at, file_name, pages, octet_length(body) as bytes, body_sha256, text';

const toPdf = (row: PdfRow, text: string): DocumentPdf => ({
  id: row.id,
  createdAt: row.created_at.toISOString(),
  fileName: `${row.file_name}.pdf`,
  pages: row.pages,
  bytes: row.bytes,
  sha256: row.body_sha256,
  current: row.text === text,
});

/** A draft as its finished document, with what saving a PDF of it needs. */
async function documentState(pool: Pool, draftId: string) {
  const state = await loadDraftState(pool, draftId, await loadFactState(pool));
  if (!state) return undefined;
  const { stored, draft } = state;
  const profile = await loadProfile(pool);
  const blocks = documentBlocks(draft, profile);
  const pieces = documentPieces(blocks);
  const text = pieces.join('\n');
  const { rows } = await pool.query<PdfRow>(
    `select ${pdfColumns} from document_pdf where artifact_id = $1 order by created_at desc`,
    [draftId],
  );
  const document: DraftDocument = {
    draftId,
    kind: draft.kind,
    jobId: draft.jobId,
    title: draft.title,
    company: draft.company,
    fileName: documentFileName(draft.kind, draft, profile),
    blocks,
    missing: documentMissing(draft, profile),
    outdated: draft.outdated,
    pdfs: rows.map((row) => toPdf(row, text)),
  };
  const edits = new Map(stored.statements.map((s) => [s.id, s.edit?.id ?? null]));
  const inDocument = draft.statements
    .filter((s) => s.inDocument)
    .map((s) => ({ claim: s.id, edit: edits.get(s.id) ?? null }));
  return { document, pieces, text, inDocument };
}

/** The newest PDF kept of a draft whose text is still the draft's document, if there is one. */
export async function currentPdf(pool: Pool, draftId: string) {
  const state = await documentState(pool, draftId);
  const pdf = state?.document.pdfs.find((p) => p.current);
  return pdf ? { id: pdf.id, fileName: pdf.fileName } : null;
}

/** A Content-Disposition header that keeps the name's accents for browsers that read them. */
export function attachment(fileName: string): string {
  const plain = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const documentRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  // Only for the upload below: a PDF is the request body as is.
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: maxPdfBytes },
    (_request, body, done) => done(null, body),
  );

  app.get(
    '/drafts/:id/document',
    { schema: { params: IdParamsSchema, response: { 200: DraftDocumentSchema } } },
    async (request) => {
      const state = await documentState(pool, request.params.id);
      if (!state) throw httpError(404, 'There is no such draft.');
      return state.document;
    },
  );

  app.post(
    '/drafts/:id/pdfs',
    {
      bodyLimit: maxPdfBytes,
      schema: { params: IdParamsSchema, response: { 200: PdfCheckSchema, 201: PdfCheckSchema } },
    },
    async (request, reply) => {
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw httpError(400, 'Upload the PDF file as the request body.');
      }
      if (!looksLikePdf(bytes)) throw httpError(400, 'This file is not a PDF.');
      const state = await documentState(pool, request.params.id);
      if (!state) throw httpError(404, 'There is no such draft.');
      if (state.document.missing.length) throw httpError(409, state.document.missing.join(' '));

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const kept = state.document.pdfs.find((pdf) => pdf.sha256 === sha256 && pdf.current);
      if (kept) return { pdf: kept, problems: [] };

      const read = await readPdf(bytes);
      if (!read.ok) throw httpError(400, read.reason);
      const problems = pdfTextProblems(state.pieces, read.pages);
      if (problems.length) return { pdf: null, problems };

      try {
        const { rows } = await pool.query<PdfRow>(
          `with new_pdf as (
             insert into document_pdf (artifact_id, body, file_name, pages, text)
             values ($1, $2, $3, $4, $5)
             returning ${pdfColumns}, artifact_id
           ),
           statements as (
             insert into document_pdf_statement
               (document_pdf_id, artifact_id, artifact_claim_id, artifact_claim_edit_id)
             select new_pdf.id, new_pdf.artifact_id, s.claim, s.edit
             from new_pdf, jsonb_to_recordset($6::jsonb) as s(claim uuid, edit uuid)
           )
           select id, created_at, file_name, pages, bytes, body_sha256, text from new_pdf`,
          [
            request.params.id,
            bytes,
            state.document.fileName,
            read.pages.length,
            state.text,
            JSON.stringify(state.inDocument),
          ],
        );
        return reply.code(201).send({ pdf: toPdf(rows[0]!, state.text), problems: [] });
      } catch (error) {
        // The same file, kept by a request that ran at the same time or for an earlier version.
        if ((error as { code?: string }).code === '23505') {
          throw httpError(409, 'The app already has this PDF. Reload the page.');
        }
        throw error;
      }
    },
  );

  app.get('/document-pdfs/:id', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const { rows } = await pool.query<{ body: Buffer; file_name: string }>(
      'select body, file_name from document_pdf where id = $1',
      [request.params.id],
    );
    const pdf = rows[0];
    if (!pdf) throw httpError(404, 'There is no such PDF.');
    return reply
      .type('application/pdf')
      .header('content-disposition', attachment(`${pdf.file_name}.pdf`))
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(pdf.body);
  });
};
