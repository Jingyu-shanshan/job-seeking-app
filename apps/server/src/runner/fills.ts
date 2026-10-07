import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  JobFillStateSchema,
  type FillField,
  type FillTask,
  type FillTaskStatus,
  type JobFillState,
  type PageBlocker,
  type PageField,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { currentForm, fillContext, formSources } from '../forms/job-form.ts';
import { httpError } from '../http-error.ts';
import { fillForm } from '../rules/form-answers.ts';
import { type FillEvent, canHappen, cannotFill, fillFields, previewFields } from '../rules/fill.ts';

// Filling a job's form with the local runner (T17), as the user sees and steers it from the job
// page: start a fill, follow it, continue it after acting in the browser window, or close it. The
// runner's side is in api.ts.

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

interface CheckRow {
  id: string;
  blocker: PageBlocker | null;
  fields: PageField[];
  created_at: Date;
}

async function toFillTask(pool: Pool, task: TaskRow): Promise<FillTask> {
  const { rows } = await pool.query<CheckRow>(
    `select id, blocker, fields, created_at from fill_check
     where fill_task_id = $1 order by created_at desc limit 1`,
    [task.id],
  );
  const check = rows[0];
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

const openStatuses: readonly FillTaskStatus[] = ['waiting', 'filling', 'paused', 'filled'];
const alreadyOpen = 'The runner has this job’s form already. Close that fill to start another.';

async function refuseUnknownJob(pool: Pool, jobId: string) {
  const exists = await pool.query('select 1 from job where id = $1', [jobId]);
  if (!exists.rowCount) throw httpError(404, 'There is no such job.');
}

export async function jobFillState(pool: Pool, jobId: string): Promise<JobFillState> {
  await refuseUnknownJob(pool, jobId);
  const [tasks, seen] = await Promise.all([
    pool.query<TaskRow>(
      `select ${taskColumns} from fill_task where job_id = $1
       order by created_at desc, id limit 1`,
      [jobId],
    ),
    pool.query<{ seen: Date | null }>(
      'select max(last_used_at) as seen from runner_token where revoked_at is null',
    ),
  ]);
  const task = tasks.rows[0];
  let cannotStart: string | null = null;
  if (task && openStatuses.includes(task.status)) {
    cannotStart = alreadyOpen;
  } else {
    const fill = await newFill(pool, jobId);
    if ('reason' in fill) cannotStart = fill.reason;
  }
  return {
    cannotStart,
    task: task ? await toFillTask(pool, task) : null,
    runnerSeenAt: seen.rows[0]?.seen?.toISOString() ?? null,
  };
}

const statusWords: Record<FillTaskStatus, string> = {
  waiting: 'waiting for the runner',
  filling: 'being filled in',
  paused: 'paused',
  filled: 'filled in',
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
    (request) =>
      userMove(
        request.params.id,
        'close',
        'closed',
        'You closed this fill; the runner closes its window.',
      ),
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
