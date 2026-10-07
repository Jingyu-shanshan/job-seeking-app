import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  CreateRunnerTokenRequestSchema,
  CreatedRunnerTokenSchema,
  RunnerTokenSchema,
  type RunnerToken,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';

// The tokens the local runner (T17) signs in with. The user issues one on the Runner page and puts
// it in the runner's environment; the app keeps only its SHA-256, so it is shown once. A revoked
// token is refused from then on, and the fills its runner had open are closed.

const prefix = 'jsa_runner_';
const tokenPattern = /^Bearer (jsa_runner_[A-Za-z0-9_-]{43})$/;

const sha256 = (token: string) => createHash('sha256').update(token).digest();

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

interface TokenRow {
  id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const toToken = (row: TokenRow): RunnerToken => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
  revokedAt: row.revoked_at?.toISOString() ?? null,
});

const tokenColumns = 'id, name, created_at, last_used_at, revoked_at';

/**
 * The runner token an `Authorization: Bearer …` header carries, if it is one the user issued and
 * did not revoke. Every use is noted, so the app can tell when a runner was last in touch.
 */
export async function runnerTokenId(
  pool: Pool,
  authorization: string | undefined,
): Promise<string | undefined> {
  const token = tokenPattern.exec(authorization ?? '')?.[1];
  if (!token) return undefined;
  const { rows } = await pool.query<{ id: string }>(
    `update runner_token set last_used_at = now()
     where token_sha256 = $1 and revoked_at is null returning id`,
    [sha256(token)],
  );
  return rows[0]?.id;
}

/**
 * Ends the fills a runner has open, whose windows it no longer has: a filled form is closed, one
 * still being filled has failed.
 */
export async function endRunnerFills(pool: Pool, tokenId: string, why: string) {
  await pool.query(
    `update fill_task
     set status = case when status = 'filled' then 'closed' else 'failed' end,
       message = $2, updated_at = now()
     where runner_token_id = $1 and status in ('filling', 'paused', 'filled')`,
    [tokenId, why],
  );
}

export const runnerTokenRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (
  app,
  { pool },
) => {
  app.get(
    '/runner-tokens',
    { schema: { response: { 200: Type.Array(RunnerTokenSchema) } } },
    async () => {
      const { rows } = await pool.query<TokenRow>(
        `select ${tokenColumns} from runner_token order by created_at desc, id`,
      );
      return rows.map(toToken);
    },
  );

  app.post(
    '/runner-tokens',
    {
      schema: {
        body: CreateRunnerTokenRequestSchema,
        response: { 201: CreatedRunnerTokenSchema },
      },
    },
    async (request, reply) => {
      const token = `${prefix}${randomBytes(32).toString('base64url')}`;
      const { rows } = await pool.query<TokenRow>(
        `insert into runner_token (name, token_sha256) values ($1, $2) returning ${tokenColumns}`,
        [request.body.name.trim().replace(/\s+/g, ' '), sha256(token)],
      );
      return reply.code(201).send({ token, runnerToken: toToken(rows[0]!) });
    },
  );

  app.delete(
    '/runner-tokens/:id',
    { schema: { params: IdParamsSchema, response: { 200: RunnerTokenSchema } } },
    async (request) => {
      const { rows } = await pool.query<TokenRow>(
        `update runner_token set revoked_at = now() where id = $1 and revoked_at is null
         returning ${tokenColumns}`,
        [request.params.id],
      );
      const row = rows[0];
      if (!row) throw httpError(404, 'There is no such token, or it is revoked already.');
      await endRunnerFills(
        pool,
        row.id,
        'You revoked the token of the runner that had this form open.',
      );
      return toToken(row);
    },
  );
};
