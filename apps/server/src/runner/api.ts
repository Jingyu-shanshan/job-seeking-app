import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  FormCheckRequestSchema,
  RunnerFailureSchema,
  RunnerTaskSchema,
  RunnerTaskStateSchema,
  SubmitProgressRequestSchema,
  SubmitResultRequestSchema,
  maxScreenshotBytes,
  type PageField,
  type RunnerTaskState,
} from '@jsa/shared';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import Type from 'typebox';
import { freezeFiles, latestMatch } from '../applications/freeze.ts';
import { httpError } from '../http-error.ts';
import { loadJobDetail } from '../jd/routes.ts';
import { canHappen, checkOutcome, lostStatus, previewFields } from '../rules/fill.ts';
import {
  approvalProblem,
  dailyCap,
  isConfirmationPage,
  progressMessages,
  submitProblem,
} from '../rules/submit.ts';
import { approvalFacts, liveApproval } from './approvals.ts';
import { type TaskRow, currentFields, moveFill, taskColumns } from './fills.ts';
import { endRunnerFills, lostMessages } from './tokens.ts';

// The API of the local runner (T17), under /api/runner. The runner signs in with its token (the
// onRequest hook in app.ts puts the token's id on the request) and sees only the fills it took. It
// takes a fill the user started, follows its status, fetches the PDFs it attaches, and sends back
// what the form holds. The rules decide where each look leaves the fill. Once the user approved a
// filled form (T18), the runner's last look before Submit decides whether it may press Submit,
// once; then it reports what the page shows and the result.

declare module 'fastify' {
  interface FastifyRequest {
    /** The runner token a request to /api/runner signed in with. */
    runnerTokenId: string;
  }
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });
const FileParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  pdfId: Type.String({ format: 'uuid' }),
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG of at most 8 MiB from base64, or a 400. */
function pngOf(base64: string): Buffer {
  const image = Buffer.from(base64, 'base64');
  if (image.length > maxScreenshotBytes || !image.subarray(0, png.length).equals(png)) {
    throw httpError(400, 'The screenshot is not a PNG of at most 8 MiB.');
  }
  return image;
}

/** The screenshot travels in base64. */
const screenshotBodyLimit = Math.ceil(maxScreenshotBytes / 3) * 4 + 4 * 1024 * 1024;

/** Each answer is the fill's status now; 409 when the runner's move could not happen. */
const stateResponse = { 200: RunnerTaskStateSchema, 409: RunnerTaskStateSchema };

export const runnerApiRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  /** A fill this runner took, noting that the runner was in touch. */
  const taskOf = async (request: FastifyRequest, id: string) => {
    const { rows } = await pool.query<TaskRow>(
      `update fill_task set runner_seen_at = now()
       where id = $1 and runner_token_id = $2 returning ${taskColumns}`,
      [id, request.runnerTokenId],
    );
    if (!rows[0]) throw httpError(404, 'This runner took no such fill.');
    return rows[0];
  };

  const stateOf = async (request: FastifyRequest, id: string): Promise<RunnerTaskState> => {
    const { status, message } = await taskOf(request, id);
    return { status, message };
  };

  // At start and on stopping: this runner has no windows, so the fills it had open have ended.
  app.post('/runner/reset', async (request, reply) => {
    await endRunnerFills(
      pool,
      request.runnerTokenId,
      'The runner stopped while it had this form open, so its window is closed.',
    );
    return reply.code(204).send();
  });

  // The oldest fill the user started that no runner has taken.
  app.post(
    '/runner/tasks/claim',
    { schema: { response: { 200: RunnerTaskSchema, 204: Type.Null() } } },
    async (request, reply) => {
      const { rows } = await pool.query<Pick<TaskRow, 'id' | 'job_id' | 'url' | 'fields'>>(
        `update fill_task
         set status = 'filling', runner_token_id = $1, runner_seen_at = now(), updated_at = now(),
           message = 'The runner has opened the form in a Chrome window on your computer.'
         where id = (
           select id from fill_task where status = 'waiting'
           order by created_at, id limit 1 for update skip locked
         )
         returning id, job_id, url, fields`,
        [request.runnerTokenId],
      );
      const task = rows[0];
      if (!task) return reply.code(204).send(null);
      const job = await loadJobDetail(pool, task.job_id);
      return {
        id: task.id,
        url: task.url,
        title: job?.title ?? '',
        company: job?.company ?? null,
        fields: task.fields,
      };
    },
  );

  app.get(
    '/runner/tasks/:id',
    { schema: { params: IdParamsSchema, response: { 200: RunnerTaskStateSchema } } },
    (request) => stateOf(request, request.params.id),
  );

  // Only a PDF the fill attaches.
  app.get(
    '/runner/tasks/:id/files/:pdfId',
    { schema: { params: FileParamsSchema } },
    async (request, reply) => {
      const task = await taskOf(request, request.params.id);
      if (!task.fields.some((f) => f.documentPdfId === request.params.pdfId)) {
        throw httpError(404, 'This fill attaches no such file.');
      }
      const { rows } = await pool.query<{ body: Buffer }>(
        'select body from document_pdf where id = $1',
        [request.params.pdfId],
      );
      return reply
        .type('application/pdf')
        .header('cache-control', 'private, no-store')
        .send(rows[0]!.body);
    },
  );

  app.post(
    '/runner/tasks/:id/checks',
    {
      bodyLimit: screenshotBodyLimit,
      schema: { params: IdParamsSchema, body: FormCheckRequestSchema, response: stateResponse },
    },
    async (request, reply) => {
      const { filledNow, blocker, fields, screenshot } = request.body;
      const image = pngOf(screenshot);
      const task = await taskOf(request, request.params.id);
      if (!canHappen(task.status, 'check')) {
        return reply.code(409).send({ status: task.status, message: task.message });
      }
      const outcome = checkOutcome(previewFields(task.fields, fields), blocker, filledNow);
      // The look is kept only when it moved the fill, in one statement with the move.
      const { rowCount } = await pool.query(
        `with moved as (
           update fill_task set status = $3, message = $4, updated_at = now()
           where id = $1 and status = $2 returning id
         )
         insert into fill_check (fill_task_id, filled_now, blocker, fields, screenshot)
         select id, $5, $6, $7, $8 from moved`,
        [
          task.id,
          task.status,
          outcome.status,
          outcome.message,
          filledNow,
          blocker,
          JSON.stringify(fields),
          image,
        ],
      );
      const state = await stateOf(request, task.id);
      return reply.code(rowCount ? 200 : 409).send(state);
    },
  );

  app.post(
    '/runner/tasks/:id/failure',
    {
      schema: { params: IdParamsSchema, body: RunnerFailureSchema, response: stateResponse },
    },
    async (request, reply) => {
      const task = await taskOf(request, request.params.id);
      const status = lostStatus(task.status, 'fail');
      const why = request.body.message.trim();
      const message =
        status === 'to_verify'
          ? `${lostMessages.submitting} (${why})`
          : `The runner could not go on: ${why}`;
      const moved = await moveFill(pool, task, 'fail', status, message);
      return reply.code(moved ? 200 : 409).send(await stateOf(request, task.id));
    },
  );

  app.post(
    '/runner/tasks/:id/window-closed',
    { schema: { params: IdParamsSchema, response: stateResponse } },
    async (request, reply) => {
      const task = await taskOf(request, request.params.id);
      const status = lostStatus(task.status, 'window_closed');
      const moved = await moveFill(
        pool,
        task,
        'window_closed',
        status,
        status === 'to_verify'
          ? `The browser window was closed after Submit was pressed, before the runner saw the result. ${lostMessages.verify}`
          : 'The browser window was closed.',
      );
      return reply.code(moved ? 200 : 409).send(await stateOf(request, task.id));
    },
  );

  // The runner's last look before Submit (T18), once the user approved the fill. The runner may
  // press Submit only when this answers `submitting`: the approval still holds and the form has
  // the approved values. Then the approval is used and the application recorded (to verify), in
  // one statement under the fill's lock, so a withdrawal cannot cross it and no approval is used
  // twice. Otherwise the approval is withdrawn and the fill goes back to the user.
  app.post(
    '/runner/tasks/:id/submit',
    {
      bodyLimit: screenshotBodyLimit,
      schema: { params: IdParamsSchema, body: FormCheckRequestSchema, response: stateResponse },
    },
    async (request, reply) => {
      const { blocker, fields, screenshot } = request.body;
      const image = pngOf(screenshot);
      const task = await taskOf(request, request.params.id);
      if (!canHappen(task.status, 'submit')) {
        return reply.code(409).send({ status: task.status, message: task.message });
      }
      const approval = await liveApproval(pool, task.id);
      const approvedLook = approval
        ? (
            await pool.query<{ fields: PageField[] }>(
              'select fields from fill_check where id = $1',
              [approval.fill_check_id],
            )
          ).rows[0]
        : undefined;
      const look = { blocker, fields };
      const problem = !approval
        ? 'There is no approval to use.'
        : (approvalProblem(
            await approvalFacts(
              pool,
              task,
              look,
              await currentFields(pool, task.job_id),
              approval.job_snapshot_id,
            ),
          ) ?? submitProblem(approvedLook!.fields, fields, blocker));
      const lookValues = [false, blocker, JSON.stringify(fields), image];
      if (!problem) {
        try {
          const { rowCount } = await pool.query(
            `with task as (
               select id, job_id, fields from fill_task
               where id = $1 and status = 'approved' for update
             ),
             used as (
               update submit_approval set used_at = now()
               where id = $2 and used_at is null and withdrawn_at is null
                 and fill_task_id in (select id from task)
                 and (select count(*) from application
                      where method = 'runner' and status <> 'not_submitted'
                        and created_at > now() - interval '24 hours') < $3
               returning id, job_snapshot_id
             ),
             applied as (
               insert into application
                 (job_id, job_snapshot_id, submit_approval_id, status, method, match_id)
               select task.job_id, used.job_snapshot_id, used.id, 'to_verify', 'runner',
                 ${latestMatch('used.job_snapshot_id')}
               from task, used
               returning id
             ),
             -- The PDFs the runner attaches, in the form's order, each kept PDF once.
             sent as (
               select applied.id as application_id,
                 (row_number() over (order by min(f.n)) - 1)::int as position,
                 min(f.e ->> 'label') as label, min(f.e -> 'answer' ->> 0) as file_name,
                 (f.e ->> 'documentPdfId')::uuid as document_pdf_id, null::bytea as body
               from applied, task, jsonb_array_elements(task.fields) with ordinality as f (e, n)
               where f.e ->> 'documentPdfId' is not null
                 and jsonb_array_length(f.e -> 'answer') > 0
               group by applied.id, f.e ->> 'documentPdfId'
             ),
             ${freezeFiles},
             moved as (
               update fill_task set status = 'submitting', message = $4, updated_at = now()
               where id in (select id from task) and exists (select 1 from applied)
               returning id
             )
             insert into fill_check (fill_task_id, filled_now, blocker, fields, screenshot)
             select id, $5, $6, $7, $8 from moved`,
            [task.id, approval!.id, dailyCap, progressMessages.other, ...lookValues],
          );
          if (rowCount) return reply.send(await stateOf(request, task.id));
        } catch (err) {
          // The job has an application that went in or may have (application_job_open).
          if ((err as { code?: string }).code !== '23505') throw err;
        }
      }
      // Not this time: the fill goes back to the user, with the look that stopped it.
      const why =
        problem ?? 'The approval could not be used (the fill or the 24-hour count changed).';
      const { rowCount: voided } = await pool.query(
        `with moved as (
           update fill_task set status = $3, message = $4, updated_at = now()
           where id = $1 and status = $2 returning id
         ),
         withdrawn as (
           update submit_approval set withdrawn_at = now()
           where fill_task_id in (select id from moved) and used_at is null and withdrawn_at is null
         )
         insert into fill_check (fill_task_id, filled_now, blocker, fields, screenshot)
         select id, $5, $6, $7, $8 from moved`,
        [
          task.id,
          task.status,
          blocker ? 'paused' : 'filled',
          `The runner did not press Submit. ${why}`,
          ...lookValues,
        ],
      );
      // Only a 200 with `submitting` lets the runner press Submit: a look that neither moved the
      // fill on nor back (another one did) is a 409, whatever the status is now.
      return reply.code(voided ? 200 : 409).send(await stateOf(request, task.id));
    },
  );

  // While the runner waits for the result of Submit: what the page shows, for the job page.
  app.post(
    '/runner/tasks/:id/progress',
    {
      schema: {
        params: IdParamsSchema,
        body: SubmitProgressRequestSchema,
        response: stateResponse,
      },
    },
    async (request, reply) => {
      const task = await taskOf(request, request.params.id);
      if (!canHappen(task.status, 'progress')) {
        return reply.code(409).send({ status: task.status, message: task.message });
      }
      await pool.query(
        `update fill_task set message = $2, updated_at = now() where id = $1 and status = 'submitting'`,
        [task.id, progressMessages[request.body.shows]],
      );
      return reply.send(await stateOf(request, task.id));
    },
  );

  // What the runner saw in the end after pressing Submit. Only Greenhouse's confirmation page for
  // this job's form counts as the application having gone in; anything else is to verify.
  app.post(
    '/runner/tasks/:id/result',
    {
      bodyLimit: screenshotBodyLimit,
      schema: { params: IdParamsSchema, body: SubmitResultRequestSchema, response: stateResponse },
    },
    async (request, reply) => {
      const { confirmation, pageUrl, pageText, note, screenshot } = request.body;
      const image = screenshot === null ? null : pngOf(screenshot);
      const task = await taskOf(request, request.params.id);
      if (!canHappen(task.status, 'result')) {
        return reply.code(409).send({ status: task.status, message: task.message });
      }
      const confirmed = confirmation && isConfirmationPage(pageUrl, task.url);
      const message = confirmed
        ? 'Greenhouse showed its confirmation page: the application went in.'
        : `Submit was pressed, but the runner did not see Greenhouse’s confirmation page. ${
            note.trim() ? `${note.trim().replace(/[^.]$/, '$&.')} ` : ''
          }${lostMessages.verify}`;
      const { rowCount } = await pool.query(
        `with moved as (
           update fill_task set status = $2, message = $3, updated_at = now()
           where id = $1 and status = 'submitting' returning id
         ),
         applied as (
           select a.id from application a join submit_approval s on s.id = a.submit_approval_id
           where s.fill_task_id in (select id from moved) and a.status = 'to_verify'
         ),
         settled as (
           update application set status = 'submitted', submitted_at = created_at
           where id in (select id from applied) and $4
         )
         insert into submit_receipt (application_id, confirmed, page_url, page_text, note, screenshot)
         select id, $4, $5, $6, $7, $8 from applied`,
        [
          task.id,
          confirmed ? 'submitted' : 'to_verify',
          message,
          confirmed,
          pageUrl,
          pageText,
          note,
          image,
        ],
      );
      return reply.code(rowCount ? 200 : 409).send(await stateOf(request, task.id));
    },
  );
};
