import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { DraftSchema, EditStatementRequestSchema, WriteDraftRequestSchema } from '@jsa/shared';
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
const StatementParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  statementId: Type.String({ format: 'uuid' }),
});

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

  // The user's version of a statement (T08): a new row next to DeepSeek's, checked like it when
  // the draft is read. Saving what the statement already is adds nothing.
  app.put(
    '/drafts/:id/statements/:statementId',
    {
      schema: {
        params: StatementParamsSchema,
        body: EditStatementRequestSchema,
        response: { 200: DraftSchema },
      },
    },
    async (request) => {
      const { id, statementId } = request.params;
      const facts = await loadFactState(pool);
      const draft = await loadDraft(pool, id, facts);
      if (!draft) throw httpError(404, 'There is no such draft.');
      const statement = draft.statements.find((s) => s.id === statementId);
      if (!statement) throw httpError(404, 'There is no such statement in this draft.');
      // A statement is one line of the document.
      const text = request.body.text.trim().replace(/\s+/g, ' ');
      const { included } = request.body;
      if (text === statement.text && included === statement.included) return draft;
      await pool.query(
        `insert into artifact_claim_edit (artifact_id, artifact_claim_id, body, included)
         values ($1, $2, $3, $4)`,
        [id, statementId, text, included],
      );
      return (await loadDraft(pool, id, facts))!;
    },
  );
};
