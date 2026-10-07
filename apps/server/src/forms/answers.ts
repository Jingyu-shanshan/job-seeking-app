import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  SaveAnswerRequestSchema,
  SavedAnswerSchema,
  type SaveAnswerRequest,
  type SavedAnswer,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { wordingKey } from '../rules/form-answers.ts';

// The user's saved answers to application-form questions (T16). Only the user writes them, on
// the Form answers page or by saving an answer they gave on a job's form; nothing else does.

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

interface AnswerRow {
  id: string;
  wordings: string[];
  answer: string[];
  sensitive: boolean;
  places: string[];
  updated_at: Date;
}

const toAnswer = (row: AnswerRow): SavedAnswer => ({
  id: row.id,
  wordings: row.wordings,
  answer: row.answer,
  sensitive: row.sensitive,
  places: row.places,
  updatedAt: row.updated_at.toISOString(),
});

const answerColumns = 'id, wordings, answer, sensitive, places, updated_at';

export async function loadSavedAnswers(pool: Pool): Promise<SavedAnswer[]> {
  const { rows } = await pool.query<AnswerRow>(
    `select ${answerColumns} from form_answer order by created_at, id`,
  );
  return rows.map(toAnswer);
}

const line = (text: string) => text.trim().replace(/\s+/g, ' ');

/** `items` trimmed, without repeats by their wording key, each with letters or digits. */
function distinct(items: readonly string[], what: string, tidy = line): string[] {
  const kept: string[] = [];
  for (const item of items.map(tidy)) {
    if (wordingKey(item) === '')
      throw httpError(400, `${what} needs letters or digits: “${item}”.`);
    if (!kept.some((k) => wordingKey(k) === wordingKey(item))) kept.push(item);
  }
  return kept;
}

/** The answer as it is saved, or a 400 that says what to change. */
export function tidyAnswer(request: SaveAnswerRequest): SaveAnswerRequest {
  const answer: string[] = [];
  for (const value of request.answer.map((v) => v.trim())) {
    if (!answer.includes(value)) answer.push(value);
  }
  return {
    wordings: distinct(request.wordings, 'A question'),
    // Kept as written: line breaks may matter in a longer answer.
    answer,
    sensitive: request.sensitive,
    places: distinct(request.places, 'A place'),
  };
}

const placesKey = (places: readonly string[]) => places.map(wordingKey).sort().join('\n');

/**
 * A 409 when another saved answer already answers one of these wordings for the same places: two
 * answers to one question would both fit, and the user would have to choose every time.
 */
export async function refuseDuplicate(pool: Pool, answer: SaveAnswerRequest, except?: string) {
  const keys = new Set(answer.wordings.map(wordingKey));
  for (const other of await loadSavedAnswers(pool)) {
    if (other.id === except || placesKey(other.places) !== placesKey(answer.places)) continue;
    const same = other.wordings.find((w) => keys.has(wordingKey(w)));
    if (same) {
      throw httpError(
        409,
        `Another saved answer already answers “${same}”${
          answer.places.length ? ' for the same places' : ''
        }. Change that one, or give this one other places.`,
      );
    }
  }
}

export async function insertAnswer(pool: Pool, answer: SaveAnswerRequest): Promise<SavedAnswer> {
  const { rows } = await pool.query<AnswerRow>(
    `insert into form_answer (wordings, answer, sensitive, places) values ($1, $2, $3, $4)
     returning ${answerColumns}`,
    [answer.wordings, answer.answer, answer.sensitive, answer.places],
  );
  return toAnswer(rows[0]!);
}

export const answerRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  app.get('/answers', { schema: { response: { 200: Type.Array(SavedAnswerSchema) } } }, () =>
    loadSavedAnswers(pool),
  );

  app.post(
    '/answers',
    { schema: { body: SaveAnswerRequestSchema, response: { 201: SavedAnswerSchema } } },
    async (request, reply) => {
      const answer = tidyAnswer(request.body);
      await refuseDuplicate(pool, answer);
      return reply.code(201).send(await insertAnswer(pool, answer));
    },
  );

  app.put(
    '/answers/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: SaveAnswerRequestSchema,
        response: { 200: SavedAnswerSchema },
      },
    },
    async (request) => {
      const answer = tidyAnswer(request.body);
      await refuseDuplicate(pool, answer, request.params.id);
      const { rows } = await pool.query<AnswerRow>(
        `update form_answer set wordings = $2, answer = $3, sensitive = $4, places = $5,
           updated_at = now()
         where id = $1 returning ${answerColumns}`,
        [request.params.id, answer.wordings, answer.answer, answer.sensitive, answer.places],
      );
      const row = rows[0];
      if (!row) throw httpError(404, 'There is no such saved answer.');
      return toAnswer(row);
    },
  );

  app.delete('/answers/:id', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const { rowCount } = await pool.query('delete from form_answer where id = $1', [
      request.params.id,
    ]);
    if (!rowCount) throw httpError(404, 'There is no such saved answer.');
    return reply.code(204).send();
  });
};
