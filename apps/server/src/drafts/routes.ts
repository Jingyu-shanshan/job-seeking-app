import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { DraftSchema, WriteDraftRequestSchema } from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { loadFactState } from '../matching/check.ts';
import { loadDraft } from './load.ts';
import { writeDraft } from './write.ts';

export interface DraftRoutesOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  deepseekApiKey: string | undefined;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const draftRoutes: FastifyPluginAsyncTypebox<DraftRoutesOptions> = async (
  app,
  { pool, fetch, deepseekApiKey },
) => {
  const writing = new Set<string>();

  // One DeepSeek request per click, for a job the user picked; refused while one runs for the same
  // text and kind, and when the latest draft of that kind already used the same facts.
  app.post(
    '/snapshots/:id/drafts',
    {
      schema: {
        params: IdParamsSchema,
        body: WriteDraftRequestSchema,
        response: { 201: DraftSchema },
      },
    },
    async (request, reply) => {
      const snapshotId = request.params.id;
      const { kind } = request.body;
      const exists = await pool.query('select 1 from job_snapshot where id = $1', [snapshotId]);
      if (!exists.rowCount) throw httpError(404, 'There is no such job text.');
      if (!deepseekApiKey) {
        throw httpError(
          503,
          'DEEPSEEK_API_KEY is not set on the server, so drafts cannot be written.',
        );
      }
      const key = `${snapshotId} ${kind}`;
      if (writing.has(key)) {
        throw httpError(409, 'This draft is already being written. Wait for that to finish.');
      }
      writing.add(key);
      let id: string;
      try {
        id = await writeDraft({
          pool,
          fetch,
          apiKey: deepseekApiKey,
          log: request.log,
          snapshotId,
          kind,
        });
      } finally {
        writing.delete(key);
      }
      return reply.code(201).send((await loadDraft(pool, id, await loadFactState(pool)))!);
    },
  );

  app.get(
    '/drafts/:id',
    { schema: { params: IdParamsSchema, response: { 200: DraftSchema } } },
    async (request) => {
      const draft = await loadDraft(pool, request.params.id, await loadFactState(pool));
      if (!draft) throw httpError(404, 'There is no such draft.');
      return draft;
    },
  );
};
