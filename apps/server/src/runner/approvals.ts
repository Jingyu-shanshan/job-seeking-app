import type {
  ApprovalFile,
  FillApproval,
  FillField,
  JobApplication,
  PageBlocker,
  PageField,
} from '@jsa/shared';
import type { Pool } from 'pg';
import { previewFields } from '../rules/fill.ts';
import { type ApprovalFacts, approvalProblem, dailyCap } from '../rules/submit.ts';

// Approving and submitting one job's application (T18): what an approval binds and whether it
// holds, read from the database. The rules are in rules/submit.ts; the routes in fills.ts (the
// user's) and api.ts (the runner's).

export interface LookRow {
  id: string;
  blocker: PageBlocker | null;
  fields: PageField[];
  created_at: Date;
}

/** The runner's latest look at the fill's form. */
export async function latestLook(pool: Pool, taskId: string): Promise<LookRow | undefined> {
  const { rows } = await pool.query<LookRow>(
    `select id, blocker, fields, created_at from fill_check
     where fill_task_id = $1 order by created_at desc limit 1`,
    [taskId],
  );
  return rows[0];
}

/** The job's current text: the one read last. */
export async function currentSnapshot(pool: Pool, jobId: string) {
  const { rows } = await pool.query<{ id: string; captured_at: Date }>(
    `select id, captured_at from job_snapshot where job_id = $1
     order by last_captured_at desc, captured_at desc limit 1`,
    [jobId],
  );
  return rows[0];
}

export interface ApprovalRow {
  id: string;
  fill_check_id: string;
  job_snapshot_id: string;
  created_at: Date;
}

/** The fill's approval that may still be used. */
export async function liveApproval(pool: Pool, taskId: string): Promise<ApprovalRow | undefined> {
  const { rows } = await pool.query<ApprovalRow>(
    `select id, fill_check_id, job_snapshot_id, created_at from submit_approval
     where fill_task_id = $1 and used_at is null and withdrawn_at is null`,
    [taskId],
  );
  return rows[0];
}

/** Applications that went in or may have in the last 24 hours. */
export async function submittedLastDay(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from application
     where status <> 'not_submitted' and created_at > now() - interval '24 hours'`,
  );
  return rows[0]!.n;
}

interface ApplicationRow {
  id: string;
  status: JobApplication['status'];
  created_at: Date;
  submitted_at: Date | null;
  receipt_id: string | null;
  confirmed: boolean | null;
  page_url: string | null;
  page_text: string | null;
  note: string | null;
  has_screenshot: boolean | null;
  receipt_at: Date | null;
}

/** The job's latest application, with what the runner saw after Submit. */
export async function jobApplication(pool: Pool, jobId: string): Promise<JobApplication | null> {
  const { rows } = await pool.query<ApplicationRow>(
    `select a.id, a.status, a.created_at, a.submitted_at, r.id as receipt_id, r.confirmed,
       r.page_url, r.page_text, r.note, r.screenshot is not null as has_screenshot,
       r.created_at as receipt_at
     from application a left join submit_receipt r on r.application_id = a.id
     where a.job_id = $1 order by a.created_at desc, a.id limit 1`,
    [jobId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
    receipt: row.receipt_id
      ? {
          confirmed: row.confirmed!,
          pageUrl: row.page_url,
          pageText: row.page_text!,
          note: row.note!,
          checkedAt: row.receipt_at!.toISOString(),
          screenshotUrl: row.has_screenshot
            ? `/api/submit-receipts/${row.receipt_id}/screenshot`
            : null,
        }
      : null,
  };
}

/** The job's application that went in or may have, if any. */
export async function openApplication(pool: Pool, jobId: string) {
  const { rows } = await pool.query<{ status: 'to_verify' | 'submitted' }>(
    `select status from application where job_id = $1 and status in ('to_verify', 'submitted')`,
    [jobId],
  );
  return rows[0]?.status ?? null;
}

export interface ApprovalTask {
  id: string;
  job_id: string;
  fields: FillField[];
}

/**
 * Everything the approval rules look at for this fill, with `look` as the look at the form.
 * `now` is what the app would put in now, or why it would not fill the form.
 */
export async function approvalFacts(
  pool: Pool,
  task: ApprovalTask,
  look: Pick<LookRow, 'blocker' | 'fields'> | undefined,
  now: FillField[] | string,
  approvedSnapshotId?: string,
): Promise<ApprovalFacts> {
  const [application, snapshot, lastDay] = await Promise.all([
    openApplication(pool, task.job_id),
    currentSnapshot(pool, task.job_id),
    submittedLastDay(pool),
  ]);
  return {
    openApplication: application,
    snapshotId: snapshot?.id ?? null,
    ...(approvedSnapshotId ? { approvedSnapshotId } : {}),
    fillFields: task.fields,
    currentFields: now,
    blocker: look?.blocker ?? null,
    preview: look ? previewFields(task.fields, look.fields) : [],
    submittedLastDay: lastDay,
  };
}

/** The PDFs the fill attaches, with the hashes an approval binds. */
async function attachedFiles(pool: Pool, fields: readonly FillField[]): Promise<ApprovalFile[]> {
  const attached = fields.filter((f) => f.documentPdfId && f.answer.length);
  if (!attached.length) return [];
  const { rows } = await pool.query<{ id: string; body_sha256: string }>(
    'select id, body_sha256 from document_pdf where id = any($1)',
    [attached.map((f) => f.documentPdfId)],
  );
  const hashes = new Map(rows.map((r) => [r.id, r.body_sha256]));
  return attached.map((f) => ({
    label: f.label,
    fileName: f.answer[0]!,
    sha256: hashes.get(f.documentPdfId!) ?? '',
  }));
}

/** Approving the fill's submission, as the job page shows it. */
export async function fillApproval(
  pool: Pool,
  task: ApprovalTask & { status: string },
  look: LookRow | undefined,
  now: FillField[] | string,
): Promise<FillApproval> {
  const approval = task.status === 'approved' ? await liveApproval(pool, task.id) : undefined;
  const [facts, files, snapshot] = await Promise.all([
    approvalFacts(pool, task, look, now, approval?.job_snapshot_id),
    attachedFiles(pool, task.fields),
    currentSnapshot(pool, task.job_id),
  ]);
  return {
    problem: look ? approvalProblem(facts) : 'The runner has not read the form yet.',
    snapshot: snapshot ? { id: snapshot.id, capturedAt: snapshot.captured_at.toISOString() } : null,
    files,
    submittedLastDay: facts.submittedLastDay,
    dailyCap,
    approvedAt: approval?.created_at.toISOString() ?? null,
  };
}
