import { lookup } from 'node:dns/promises';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ToolRequestSchema, type ToolCall, type ToolRequest } from '@jsa/shared';
import type { Pool } from 'pg';
import { httpError } from '../http-error.ts';
import { pageUrl, publicAddress } from '../jd/company-page.ts';
import { callTool, checkToolInput, toolPriceUsd } from './provider.ts';

export interface ToolOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  deepseekApiKey?: string | undefined;
}

const columns = `id,tool,input,created_at as "createdAt",result,message,
    coalesce(cost_usd,reserved_usd)::float8 as "costUsd",cost_usd is null as estimated`;

/** A saved request ID owns its reservation and is never sent twice, across entry points too. */
export async function runTool(
  { pool, fetch, deepseekApiKey }: ToolOptions,
  body: ToolRequest,
): Promise<ToolCall> {
  const previous = await pool.query<ToolCall>(`select ${columns} from tool_call where id=$1`, [
    body.id,
  ]);
  if (previous.rows[0]) {
    if (previous.rows[0].tool !== body.tool || previous.rows[0].input !== body.input.trim())
      throw httpError(409, 'This request ID already belongs to a different operation.');
    return previous.rows[0];
  }
  if (!deepseekApiKey)
    throw httpError(503, 'Set DEEPSEEK_API_KEY on the server before using web tools.');
  if (body.maxCostUsd < toolPriceUsd)
    throw httpError(
      409,
      'The approved cost limit is below the estimated fee. Refresh and review the fee.',
    );
  const input = body.input.trim();
  checkToolInput(body.tool, input);
  if (body.tool === 'fetch') {
    const url = pageUrl(input);
    // shortcut: target redirects and DNS are controlled by DeepSeek; require final-URL controls before job-import integration.
    let addresses;
    try {
      addresses = await lookup(url.hostname, { all: true });
    } catch {
      throw httpError(400, 'The page address could not be resolved. Check the link.');
    }
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      throw httpError(400, 'Use a public website address.');
  }
  const claim = await pool.query(
    `insert into tool_call(id,tool,input,reserved_usd)
      values($1,$2,$3,$4) on conflict do nothing returning id`,
    [body.id, body.tool, input, toolPriceUsd],
  );
  if (claim.rowCount) {
    const outcome = await callTool({ tool: body.tool, input, apiKey: deepseekApiKey, fetch });
    await pool.query(
      `update tool_call set cost_usd=$2,result=$3,message=$4,finished_at=now()
        where id=$1 and finished_at is null`,
      [body.id, outcome.cost ?? null, JSON.stringify(outcome.result), outcome.message],
    );
  }
  const saved = (
    await pool.query<ToolCall>(`select ${columns} from tool_call where id=$1`, [body.id])
  ).rows[0]!;
  if (saved.tool !== body.tool || saved.input !== input)
    throw httpError(409, 'This request ID already belongs to a different operation.');
  return saved;
}

export const toolRoutes: FastifyPluginAsyncTypebox<ToolOptions> = async (app, options) => {
  const { pool, deepseekApiKey } = options;
  app.get('/tools', async () => ({
    available: !!deepseekApiKey,
    estimatedCostUsd: toolPriceUsd,
    calls: (
      await pool.query<ToolCall>(
        `select ${columns} from tool_call order by created_at desc,id limit 30`,
      )
    ).rows,
  }));
  app.post('/tools', { schema: { body: ToolRequestSchema } }, async ({ body }) =>
    runTool(options, body),
  );
};
