import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ApproveFillRequestSchema,
  JobFillStateSchema,
  SettleApplicationRequestSchema,
  type FillField,
  type FillTask,
  type FillTaskStatus,
  type JobFillState,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { currentForm, fillContext, formSources } from '../forms/job-form.ts';
import { httpError } from '../http-error.ts';
import { fillForm } from '../rules/form-answers.ts';
import { type FillEvent, canHappen, cannotFill, fillFields, previewFields } from '../rules/fill.ts';
import { approvalProblem } from '../rules/submit.ts';
import {
  type LookRow,
  approvalFacts,
  currentSnapshot,
  fillApproval,
  jobApplication,
  latestLook,
} from './approvals.ts';

// Filling a job's form with the local runner (T17), as the user sees and steers it from the job
// page: start a fill, follow it, continue it after acting in the browser window, or close it; then
// (T18) approve the filled form for submitting or withdraw the approval, and say whether an
// application whose result is unknown went through. The runner's side is in api.ts.

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

export interface TaskRow {
  id: string;
  job_id: string;
  url: string;
  fields: FillField[];
  status: FillTaskStatus;
  message: string;
  created_at: Date;
  updated_at: Date;
  runner_seen_at: Date | null;
}

export const taskColumns =
  'id, job_id, url, fields, status, message, created_at, updated_at, runner_seen_at';

function toFillTask(task: TaskRow, check: LookRow | undefined): FillTask {
  return {
    id: task.id,
    status: task.status,
    message: task.message,
    url: task.url,
    createdAt: task.created_at.toISOString(),
    updatedAt: task.updated_at.toISOString(),
    runnerSeenAt: task.runner_seen_at?.toISOString() ?? null,
    check: check
      ? {
          id: check.id,
          checkedAt: check.created_at.toISOString(),
          blocker: check.blocker,
          fields: previewFields(task.fields, check.fields),
          screenshotUrl: `/api/fill-checks/${check.id}/screenshot`,
        }
      : null,
  };
}

/**
 * What a new fill of the job would hold: the page of its form and the answers the app has now.
 * Or why it cannot start.
 */
async function newFill(
  pool: Pool,
  jobId: string,
): Promise<{ reason: string } | { url: string; formId: string; fields: FillField[] }> {
  const source = (await formSources(pool, jobId)).find((s) => s.adapter.formPage);
  if (!source) {
    return { reason: 'The runner fills only the forms of jobs on a Greenhouse board you use.' };
  }
  const form = await currentForm(pool, jobId);
  if (!form) return { reason: 'Read the job’s application form first.' };
  const context = await fillContext(pool, jobId);
  const fills = fillForm(form.questions, context!);
  const reason = cannotFill(fills);
  if (reason) return { reason };
  const { posting, adapter } = source;
  return {
    url: adapter.formPage!(posting.param, posting.external_id),
    formId: form.id,
    fields: fillFields(fills),
  };
}

/** What the app would put in the job's form now, or why it would not fill it. */
export async function currentFields(pool: Pool, jobId: string): Promise<FillField[] | string> {
  const fill = await newFill(pool, jobId);
  return 'reason' in fill ? fill.reason : fill.fields;
}

/** Why the job may not be filled for submitting again, given its latest application. */
function applied(application: JobFillState['application']): string | null {
  if (application?.status === 'submitted') return 'This job’s application went in already.';
  if (application?.status === 'to_verify') {
    return 'The result of this job’s application is unknown. Say below whether it went through first.';
  }
  return null;
}

const openStatuses: readonly FillTaskStatus[] = [
  'waiting',
  'filling',
  'paused',
  'filled',
  'approved',
  'submitting',
];
const alreadyOpen = 'The runner has this job’s form already. Close that fill to start another.';

async function refuseUnknownJob(pool: Pool, jobId: string) {
  const exists = await pool.query('select 1 from job where id = $1', [jobId]);
  if (!exists.rowCount) throw httpError(404, 'There is no such job.');
}

export async function jobFillState(pool: Pool, jobId: string): Promise<JobFillState> {
  await refuseUnknownJob(pool, jobId);
  const [tasks, seen, application] = await Promise.all([
    pool.query<TaskRow>(
      `select ${taskColumns} from fill_task where job_id = $1
       order by created_at desc, id limit 1`,
      [jobId],
    ),
    pool.query<{ seen: Date | null }>(
      'select max(last_used_at) as seen from runner_token where revoked_at is null',
    ),
    jobApplication(pool, jobId),
  ]);
  const task = tasks.rows[0];
  const look = task && (await latestLook(pool, task.id));
  const busy = task !== undefined && openStatuses.includes(task.status);
  const approving = task?.status === 'filled' || task?.status === 'approved';
  // What the app would put in now: for a new fill, or to see whether an approval holds.
  const fields = !busy || approving ? await currentFields(pool, jobId) : [];
  const cannotStart = busy
    ? alreadyOpen
    : (applied(application) ?? (typeof fields === 'string' ? fields : null));
  return {
    cannotStart,
    task: task ? toFillTask(task, look) : null,
    runnerSeenAt: seen.rows[0]?.seen?.toISOString() ?? null,
    approval: approving ? await fillApproval(pool, task, look, fields) : null,
    application,
  };
}

const statusWords: Record<FillTaskStatus, string> = {
  waiting: 'waiting for the runner',
  filling: 'being filled in',
  paused: 'paused',
  filled: 'filled in',
  approved: 'approved for submitting',
  submitting: 'being submitted',
  submitted: 'submitted',
  to_verify: 'submitted with an unknown result',
  closed: 'closed',
  failed: 'failed',
};

/**
 * Moves the fill to `status` on `event`, if the event can happen in the fill's status now; else
 * false. Two moves never cross: the update only applies to the status the rules were asked about.
 */
export async function moveFill(
  pool: Pool,
  task: Pick<TaskRow, 'id' | 'status'>,
  event: FillEvent,
  status: FillTaskStatus,
  message: string,
): Promise<boolean> {
  if (!canHappen(task.status, event)) return false;
  const { rowCount } = await pool.query(
    `update fill_task set status = $3, message = $4, updated_at = now()
     where id = $1 and status = $2`,
    [task.id, task.status, status, message],
  );
  return rowCount === 1;
}

export const fillRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  const taskOf = async (id: string) => {
    const { rows } = await pool.query<TaskRow>(
      `select ${taskColumns} from fill_task where id = $1`,
      [id],
    );
    if (!rows[0]) throw httpError(404, 'There is no such fill.');
    return rows[0];
  };

  /** The user's move: the job's fill state, or a 409 that says why it cannot happen now. */
  const userMove = async (
    id: string,
    event: FillEvent,
    status: FillTaskStatus,
    message: string,
  ) => {
    const task = await taskOf(id);
    if (!(await moveFill(pool, task, event, status, message))) {
      const now = await taskOf(id);
      throw httpError(409, `This fill is ${statusWords[now.status]}, so that cannot be done now.`);
    }
    return jobFillState(pool, task.job_id);
  };

  app.get(
    '/jobs/:id/fill',
    { schema: { params: IdParamsSchema, response: { 200: JobFillStateSchema } } },
    (request) => jobFillState(pool, request.params.id),
  );

  // The user starts a fill of this one job. The runner takes it when it asks for work next.
  app.post(
    '/jobs/:id/fill',
    { schema: { params: IdParamsSchema, response: { 201: JobFillStateSchema } } },
    async (request, reply) => {
      const jobId = request.params.id;
      await refuseUnknownJob(pool, jobId);
      const refusal = applied(await jobApplication(pool, jobId));
      if (refusal) throw httpError(409, refusal);
      const fill = await newFill(pool, jobId);
      if ('reason' in fill) throw httpError(409, fill.reason);
      try {
        await pool.query(
          `insert into fill_task (job_id, job_form_id, url, fields, message) values ($1, $2, $3, $4, $5)`,
          [
            jobId,
            fill.formId,
            fill.url,
            JSON.stringify(fill.fields),
            'Waiting for the runner on your computer to take it.',
          ],
        );
      } catch (err) {
        // The job has an open fill (fill_task_open).
        if ((err as { code?: string }).code === '23505') throw httpError(409, alreadyOpen);
        throw err;
      }
      return reply.code(201).send(await jobFillState(pool, jobId));
    },
  );

  // After the user acted in the window: the runner looks at the form again.
  app.post(
    '/fill-tasks/:id/continue',
    { schema: { params: IdParamsSchema, response: { 200: JobFillStateSchema } } },
    (request) =>
      userMove(
        request.params.id,
        'continue',
        'filling',
        'The runner is looking at the form again.',
      ),
  );

  app.post(
    '/fill-tasks/:id/close',
    { schema: { params: IdParamsSchema, response: { 200: JobFillStateSchema } } },
    async (request) => {
      const state = await userMove(
        request.params.id,
        'close',
        'closed',
        'You closed this fill; the runner closes its window.',
      );
      // A closed fill is never submitted; the approval is marked so that it reads that way.
      await pool.query(
        `update submit_approval set withdrawn_at = now()
         where fill_task_id = $1 and used_at is null and withdrawn_at is null`,
        [request.params.id],
      );
      return state;
    },
  );

  // The user approves submitting the form as the runner last read it (T18): `checkId` is the look
  // they saw. The runner reads the form once more and presses Submit only if nothing changed.
  app.post(
    '/fill-tasks/:id/approve',
    {
      schema: {
        params: IdParamsSchema,
        body: ApproveFillRequestSchema,
        response: { 200: JobFillStateSchema },
      },
    },
    async (request) => {
      const task = await taskOf(request.params.id);
      if (!canHappen(task.status, 'approve')) {
        throw httpError(409, `This fill is ${statusWords[task.status]}, so it cannot be approved.`);
      }
      const look = await latestLook(pool, task.id);
      if (look?.id !== request.body.checkId) {
        throw httpError(409, 'The runner read the form again since. Look at it as it is now.');
      }
      const facts = await approvalFacts(pool, task, look, await currentFields(pool, task.job_id));
      const problem = approvalProblem(facts);
      if (problem) throw httpError(409, problem);
      const snapshot = await currentSnapshot(pool, task.job_id);
      // Only while the fill is filled and the look is still its latest.
      const { rowCount } = await pool.query(
        `with moved as (
           update fill_task set status = 'approved', message = $4, updated_at = now()
           where id = $1 and status = 'filled'
             and (select id from fill_check where fill_task_id = $1
                  order by created_at desc limit 1) = $2
           returning id
         )
         insert into submit_approval (fill_task_id, fill_check_id, job_snapshot_id)
         select id, $2, $3 from moved`,
        [
          task.id,
          look.id,
          snapshot!.id,
          'You approved submitting this form. The runner reads it once more and presses Submit if nothing changed.',
        ],
      );
      if (!rowCount) throw httpError(409, 'The fill changed meanwhile. Look at it as it is now.');
      return jobFillState(pool, task.job_id);
    },
  );

  app.post(
    '/fill-tasks/:id/withdraw',
    { schema: { params: IdParamsSchema, response: { 200: JobFillStateSchema } } },
    async (request) => {
      const task = await taskOf(request.params.id);
      // Not once the runner has pressed Submit: that moved the fill on under the same lock.
      const { rowCount } = await pool.query(
        `with moved as (
           update fill_task set status = 'filled', message = $2, updated_at = now()
           where id = $1 and status = 'approved' returning id
         )
         update submit_approval set withdrawn_at = now()
         where fill_task_id in (select id from moved) and used_at is null and withdrawn_at is null`,
        [task.id, 'You withdrew your approval. Nothing has been sent to the company.'],
      );
      if (!rowCount) {
        const now = await taskOf(task.id);
        throw httpError(
          409,
          `This fill is ${statusWords[now.status]}, so that cannot be done now.`,
        );
      }
      return jobFillState(pool, task.job_id);
    },
  );

  // The user's word on an application whose result was unknown: it went through, or it did not
  // (then the job may be approved again). Not while the runner still watches the page.
  app.post(
    '/applications/:id/settle',
    {
      schema: {
        params: IdParamsSchema,
        body: SettleApplicationRequestSchema,
        response: { 200: JobFillStateSchema },
      },
    },
    async (request) => {
      const { submitted } = request.body;
      const { rows } = await pool.query<{ job_id: string }>(
        `update application a
         set status = $2, submitted_at = case when $3 then a.created_at end
         where a.id = $1 and a.status = 'to_verify'
           and not exists (
             select 1 from submit_approval s join fill_task t on t.id = s.fill_task_id
             where s.id = a.submit_approval_id and t.status = 'submitting'
           )
         returning a.job_id`,
        [request.params.id, submitted ? 'submitted' : 'not_submitted', submitted],
      );
      if (!rows[0]) {
        const exists = await pool.query('select 1 from application where id = $1', [
          request.params.id,
        ]);
        if (!exists.rowCount) throw httpError(404, 'There is no such application.');
        throw httpError(
          409,
          'Only an application whose result is unknown can be settled, once the runner is done with it.',
        );
      }
      return jobFillState(pool, rows[0].job_id);
    },
  );

  app.get(
    '/submit-receipts/:id/screenshot',
    { schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const { rows } = await pool.query<{ screenshot: Buffer | null }>(
        'select screenshot from submit_receipt where id = $1',
        [request.params.id],
      );
      if (!rows[0]?.screenshot) throw httpError(404, 'There is no such screenshot.');
      return reply
        .type('image/png')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(rows[0].screenshot);
    },
  );

  app.get(
    '/fill-checks/:id/screenshot',
    { schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const { rows } = await pool.query<{ screenshot: Buffer }>(
        'select screenshot from fill_check where id = $1',
        [request.params.id],
      );
      if (!rows[0]) throw httpError(404, 'There is no such screenshot.');
      return reply
        .type('image/png')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(rows[0].screenshot);
    },
  );
};
