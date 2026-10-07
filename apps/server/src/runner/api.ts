import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  FormCheckRequestSchema,
  RunnerFailureSchema,
  RunnerTaskSchema,
  RunnerTaskStateSchema,
  maxScreenshotBytes,
  type RunnerTaskState,
} from '@jsa/shared';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { loadJobDetail } from '../jd/routes.ts';
import { canHappen, checkOutcome, previewFields } from '../rules/fill.ts';
import { type TaskRow, moveFill, taskColumns } from './fills.ts';
import { endRunnerFills } from './tokens.ts';

// The API of the local runner (T17), under /api/runner. The runner signs in with its token (the
// onRequest hook in app.ts puts the token's id on the request) and sees only the fills it took. It
// takes a fill the user started, follows its status, fetches the PDFs it attaches, and sends back
// what the form holds. The rules decide where each look leaves the fill; nothing here submits.

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
      // The screenshot travels in base64.
      bodyLimit: Math.ceil(maxScreenshotBytes / 3) * 4 + 4 * 1024 * 1024,
      schema: { params: IdParamsSchema, body: FormCheckRequestSchema, response: stateResponse },
    },
    async (request, reply) => {
      const { filledNow, blocker, fields, screenshot } = request.body;
      const image = Buffer.from(screenshot, 'base64');
      if (image.length > maxScreenshotBytes || !image.subarray(0, png.length).equals(png)) {
        throw httpError(400, 'The screenshot is not a PNG of at most 8 MiB.');
      }
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
      const message = `The runner could not go on: ${request.body.message.trim()}`;
      const moved = await moveFill(pool, task, 'fail', 'failed', message);
      return reply.code(moved ? 200 : 409).send(await stateOf(request, task.id));
    },
  );

  app.post(
    '/runner/tasks/:id/window-closed',
    { schema: { params: IdParamsSchema, response: stateResponse } },
    async (request, reply) => {
      const task = await taskOf(request, request.params.id);
      const moved = await moveFill(
        pool,
        task,
        'window_closed',
        'closed',
        'The browser window was closed.',
      );
      return reply.code(moved ? 200 : 409).send(await stateOf(request, task.id));
    },
  );
};
