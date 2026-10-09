import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ApplicationRecordSchema,
  ApplicationsResponseSchema,
  JobApplicationsSchema,
  RecordApplicationRequestSchema,
  maxPdfBytes,
  type ApplicationRecord,
  type ApplicationSummary,
  type FrozenMatch,
  type JobApplications,
  type PageField,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { attachment } from '../documents/routes.ts';
import { looksLikePdf, readPdf } from '../documents/pdf.ts';
import { httpError } from '../http-error.ts';
import { cannotRecord, repeatedFiles, sentAtProblem } from '../rules/application.ts';
import { type ReceiptRow, receiptColumns, toReceipt } from '../runner/approvals.ts';
import { freezeFiles, latestMatch } from './freeze.ts';

// Applications as they were recorded (T09): the list, one application with everything frozen with
// it, the files that went out, and recording an application the user sent outside the app.

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

/** A runner fill that is not over; recording one by hand waits until it is. */
const openFillStatuses = ['waiting', 'filling', 'paused', 'filled', 'approved', 'submitting'];

interface SummaryRow {
  id: string;
  job_id: string;
  title: string;
  company: string | null;
  status: ApplicationSummary['status'];
  method: ApplicationSummary['method'];
  created_at: Date;
  submitted_at: Date | null;
}

const summaryColumns = `a.id, a.job_id, s.title, s.company, a.status, a.method, a.created_at,
  a.submitted_at`;

const toSummary = (row: SummaryRow): ApplicationSummary => ({
  id: row.id,
  jobId: row.job_id,
  title: row.title,
  company: row.company,
  status: row.status,
  method: row.method,
  createdAt: row.created_at.toISOString(),
  submittedAt: row.submitted_at?.toISOString() ?? null,
});

/** The job's applications, newest first, and whether one sent outside the app can be recorded. */
async function jobApplications(pool: Pool, jobId: string): Promise<JobApplications | undefined> {
  const { rows: jobs } = await pool.query<{
    has_text: boolean;
    open_application: 'submitted' | 'to_verify' | null;
    open_fill: boolean;
  }>(
    `select exists (select 1 from job_snapshot where job_id = j.id) as has_text,
       (select status from application where job_id = j.id
          and status in ('submitted', 'to_verify')) as open_application,
       exists (select 1 from fill_task where job_id = j.id and status = any($2)) as open_fill
     from job j where j.id = $1`,
    [jobId, openFillStatuses],
  );
  const job = jobs[0];
  if (!job) return undefined;
  const [applications, pdfs] = await Promise.all([
    pool.query<SummaryRow>(
      `select ${summaryColumns}
       from application a join job_snapshot s on s.id = a.job_snapshot_id
       where a.job_id = $1 order by a.created_at desc, a.id`,
      [jobId],
    ),
    pool.query<{
      id: string;
      kind: 'resume' | 'cover_letter';
      file_name: string;
      created_at: Date;
      body_sha256: string;
    }>(
      `select d.id, a.kind, d.file_name, d.created_at, d.body_sha256
       from document_pdf d join artifact a on a.id = d.artifact_id
         join job_snapshot s on s.id = a.job_snapshot_id
       where s.job_id = $1 order by d.created_at desc, d.id`,
      [jobId],
    ),
  ]);
  return {
    applications: applications.rows.map(toSummary),
    cannotRecord: cannotRecord({
      hasText: job.has_text,
      openApplication: job.open_application,
      openFill: job.open_fill,
    }),
    pdfs: pdfs.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      fileName: `${row.file_name}.pdf`,
      createdAt: row.created_at.toISOString(),
      sha256: row.body_sha256,
    })),
  };
}

/** An application with everything frozen with it. */
async function applicationRecord(pool: Pool, id: string): Promise<ApplicationRecord | undefined> {
  const { rows } = await pool.query<
    SummaryRow &
      ReceiptRow & {
        application_note: string;
        match_id: string | null;
        submit_approval_id: string | null;
        job_snapshot_id: string;
        location: string;
        source_url: string;
        captured_at: Date;
        body: string;
      }
  >(
    `select ${summaryColumns}, a.note as application_note, a.match_id, a.submit_approval_id, a.job_snapshot_id,
       s.location, s.source_url, s.captured_at, s.body, ${receiptColumns}
     from application a join job_snapshot s on s.id = a.job_snapshot_id
       left join submit_receipt r on r.application_id = a.id
     where a.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;

  const [match, requirements, files, facts, form] = await Promise.all([
    pool.query<{ id: string; created_at: Date; verdict: FrozenMatch['verdict'] }>(
      'select id, created_at, verdict from match where id = $1',
      [row.match_id],
    ),
    pool.query<{
      kind: 'must' | 'nice';
      body: string;
      outcome: 'met' | 'unmet' | 'unknown';
      note: string;
    }>(
      `select q.kind, q.body, r.outcome, r.note
       from match_requirement r join job_requirement q on q.id = r.job_requirement_id
       where r.match_id = $1 order by q.kind, q.created_at, q.id`,
      [row.match_id],
    ),
    pool.query<{
      id: string;
      label: string;
      file_name: string;
      bytes: number;
      body_sha256: string;
      artifact_id: string | null;
      kind: 'resume' | 'cover_letter' | null;
    }>(
      `select f.id, f.label, f.file_name, coalesce(octet_length(f.body), octet_length(d.body)) as bytes,
         f.body_sha256, d.artifact_id, t.kind
       from application_file f left join document_pdf d on d.id = f.document_pdf_id
         left join artifact t on t.id = d.artifact_id
       where f.application_id = $1 order by f.position`,
      [id],
    ),
    pool.query<{
      id: string;
      fact_id: string;
      kind: ApplicationRecord['facts'][number]['kind'];
      version: number;
      body: string;
      still_current: boolean;
    }>(
      `select v.id, v.fact_id, f.kind, v.version, v.body,
         v.status = 'confirmed' and v.version =
           (select max(w.version) from fact_version w where w.fact_id = v.fact_id) as still_current
       from application_fact_version x join fact_version v on v.id = x.fact_version_id
         join fact f on f.id = v.fact_id
       where x.application_id = $1 order by f.kind, f.created_at, f.id`,
      [id],
    ),
    pool.query<{ created_at: Date; check_id: string; fields: PageField[] }>(
      `select s.created_at, c.id as check_id, c.fields
       from submit_approval s join fill_check c on c.id = s.fill_check_id where s.id = $1`,
      [row.submit_approval_id],
    ),
  ]);

  const matched = match.rows[0];
  const approved = form.rows[0];
  return {
    ...toSummary(row),
    note: row.application_note,
    job: {
      snapshotId: row.job_snapshot_id,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.source_url,
      capturedAt: row.captured_at.toISOString(),
      text: row.body,
    },
    match: matched
      ? {
          id: matched.id,
          createdAt: matched.created_at.toISOString(),
          verdict: matched.verdict,
          requirements: requirements.rows.map((r) => ({
            kind: r.kind,
            text: r.body,
            outcome: r.outcome,
            note: r.note,
          })),
        }
      : null,
    files: files.rows.map((f) => ({
      id: f.id,
      label: f.label,
      fileName: f.file_name,
      bytes: f.bytes,
      sha256: f.body_sha256,
      draft: f.artifact_id ? { id: f.artifact_id, kind: f.kind! } : null,
      url: `/api/application-files/${f.id}`,
    })),
    facts: facts.rows.map((f) => ({
      factVersionId: f.id,
      factId: f.fact_id,
      kind: f.kind,
      version: f.version,
      text: f.body,
      stillCurrent: f.still_current,
    })),
    form: approved
      ? {
          approvedAt: approved.created_at.toISOString(),
          fields: approved.fields.map((f) => ({ label: f.label, value: f.value })),
          screenshotUrl: `/api/fill-checks/${approved.check_id}/screenshot`,
        }
      : null,
    receipt: toReceipt(row),
  };
}

export const applicationRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (
  app,
  { pool },
) => {
  app.get(
    '/applications',
    { schema: { response: { 200: ApplicationsResponseSchema } } },
    async () => {
      const { rows } = await pool.query<SummaryRow>(
        `select ${summaryColumns}
         from application a join job_snapshot s on s.id = a.job_snapshot_id
         order by coalesce(a.submitted_at, a.created_at) desc, a.id`,
      );
      return { applications: rows.map(toSummary) };
    },
  );

  app.get(
    '/applications/:id',
    { schema: { params: IdParamsSchema, response: { 200: ApplicationRecordSchema } } },
    async (request) => {
      const record = await applicationRecord(pool, request.params.id);
      if (!record) throw httpError(404, 'There is no such application.');
      return record;
    },
  );

  app.get(
    '/application-files/:id',
    { schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const { rows } = await pool.query<{ body: Buffer; file_name: string }>(
        `select coalesce(f.body, d.body) as body, f.file_name
         from application_file f left join document_pdf d on d.id = f.document_pdf_id
         where f.id = $1`,
        [request.params.id],
      );
      const file = rows[0];
      if (!file) throw httpError(404, 'There is no such file.');
      return reply
        .type('application/pdf')
        .header('content-disposition', attachment(file.file_name))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(file.body);
    },
  );

  app.get(
    '/jobs/:id/applications',
    { schema: { params: IdParamsSchema, response: { 200: JobApplicationsSchema } } },
    async (request) => {
      const state = await jobApplications(pool, request.params.id);
      if (!state) throw httpError(404, 'There is no such job.');
      return state;
    },
  );

  // The user applied to the job outside the app. The record keeps the job's current text, the
  // match of it, the kept PDFs they say went out and the files they upload as sent. It counts as
  // applied at once, and not toward the runner's 24-hour cap (user decision).
  app.post(
    '/jobs/:id/applications',
    {
      // Three PDFs in base64, and the rest.
      bodyLimit: 4 * Math.ceil(maxPdfBytes / 3) * 4 + 64 * 1024,
      schema: {
        params: IdParamsSchema,
        body: RecordApplicationRequestSchema,
        response: { 201: JobApplicationsSchema },
      },
    },
    async (request, reply) => {
      const jobId = request.params.id;
      const { note, documentPdfIds } = request.body;
      const state = await jobApplications(pool, jobId);
      if (!state) throw httpError(404, 'There is no such job.');
      if (state.cannotRecord) throw httpError(409, state.cannotRecord);

      const sentAt = new Date(request.body.submittedAt);
      const timeProblem = sentAtProblem(sentAt, new Date());
      if (timeProblem) throw httpError(400, timeProblem);

      const kept = new Map(state.pdfs.map((pdf) => [pdf.id, pdf]));
      const picked = documentPdfIds.map((id) => {
        const pdf = kept.get(id);
        if (!pdf) throw httpError(400, 'A PDF you picked is not one of this job’s.');
        return pdf;
      });
      const uploads = [];
      for (const file of request.body.files) {
        const fileName = file.fileName.trim();
        const body = Buffer.from(file.body, 'base64');
        if (!body.length || body.length > maxPdfBytes) {
          throw httpError(400, `${fileName} is empty or larger than 2 MiB.`);
        }
        if (!looksLikePdf(body)) throw httpError(400, `${fileName} is not a PDF.`);
        const read = await readPdf(body);
        if (!read.ok) throw httpError(400, `${fileName}: ${read.reason}`);
        uploads.push({ fileName, body, sha256: createHash('sha256').update(body).digest('hex') });
      }
      const repeated = repeatedFiles([...picked, ...uploads]);
      if (repeated.length) {
        throw httpError(400, `The same file is given twice: ${repeated.join(', ')}.`);
      }

      const sent = [
        ...picked.map((pdf) => ({ fileName: pdf.fileName, pdfId: pdf.id, body: null })),
        ...uploads.map((file) => ({ fileName: file.fileName, pdfId: null, body: file.body })),
      ];
      try {
        const { rowCount } = await pool.query(
          `with jd as (
             select id from job_snapshot where job_id = $1
             order by last_captured_at desc, captured_at desc limit 1
           ),
           applied as (
             insert into application
               (job_id, job_snapshot_id, status, submitted_at, method, note, match_id)
             select $1, jd.id, 'submitted', least($2::timestamptz, now()), 'manual', $3,
               ${latestMatch('jd.id')}
             from jd
             where not exists (select 1 from fill_task where job_id = $1 and status = any($7))
             returning id
           ),
           sent as (
             select applied.id as application_id, (f.n - 1)::int as position, ''::text as label,
               f.file_name, f.document_pdf_id, f.body
             from applied, unnest($4::text[], $5::uuid[], $6::bytea[])
               with ordinality as f (file_name, document_pdf_id, body, n)
           ),
           ${freezeFiles}
           select id from applied`,
          [
            jobId,
            sentAt,
            note.trim(),
            sent.map((f) => f.fileName),
            sent.map((f) => f.pdfId),
            sent.map((f) => f.body),
            openFillStatuses,
          ],
        );
        if (!rowCount) throw httpError(409, 'Close the runner’s fill of this job’s form first.');
      } catch (error) {
        // Another application of the job went in or may have meanwhile (application_job_open).
        if ((error as { code?: string }).code === '23505') {
          throw httpError(409, 'This job already has an application. Reload the page.');
        }
        throw error;
      }
      return reply.code(201).send((await jobApplications(pool, jobId))!);
    },
  );
};
