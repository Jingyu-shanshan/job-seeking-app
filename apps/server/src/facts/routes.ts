import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AddFactRequestSchema,
  EditFactRequestSchema,
  FactKindSchema,
  FactSchema,
  FactsResponseSchema,
  ImportFactsRequestSchema,
  ImportFactsResponseSchema,
  UpdateFactVersionRequestSchema,
  maxFactLength,
  type Fact,
  type FactKind,
  type FactStatus,
  type FactVersion,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { currentVersion, mayUse, sensitiveData, statusChangeAllowed } from '../rules/facts.ts';
import { parseFactsMarkdown } from './markdown.ts';

export interface FactRoutesOptions {
  pool: Pool;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

const kindOrder = FactKindSchema.anyOf.map((literal) => literal.const) as FactKind[];

interface VersionRow {
  fact_id: string;
  kind: FactKind;
  fact_created_at: Date;
  id: string;
  version: number;
  body: string;
  source: string;
  status: FactStatus;
  may_send_to_model: boolean;
  may_use_in_materials: boolean;
  created_at: Date;
}

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

export async function loadFacts(pool: Pool, factId?: string): Promise<Fact[]> {
  const { rows } = await pool.query<VersionRow>(
    `select f.id as fact_id, f.kind, f.created_at as fact_created_at, v.id, v.version, v.body,
       v.source, v.status, v.may_send_to_model, v.may_use_in_materials, v.created_at
     from fact f join fact_version v on v.fact_id = f.id
     where $1::uuid is null or f.id = $1
     order by f.created_at, f.id, v.version desc`,
    [factId ?? null],
  );
  const byFact = new Map<string, VersionRow[]>();
  for (const row of rows) byFact.set(row.fact_id, [...(byFact.get(row.fact_id) ?? []), row]);

  const facts = [...byFact.values()].map((versions): Fact => {
    const states = versions.map((v) => ({
      version: v.version,
      body: v.body,
      status: v.status,
      maySendToModel: v.may_send_to_model,
      mayUseInMaterials: v.may_use_in_materials,
    }));
    const latest = currentVersion(versions);
    const toVersion = (v: VersionRow): FactVersion => ({
      id: v.id,
      version: v.version,
      body: v.body,
      source: v.source,
      status: v.status,
      maySendToModel: v.may_send_to_model,
      mayUseInMaterials: v.may_use_in_materials,
      createdAt: v.created_at.toISOString(),
    });
    return {
      id: latest.fact_id,
      kind: latest.kind,
      createdAt: latest.fact_created_at.toISOString(),
      current: toVersion(latest),
      earlier: versions.filter((v) => v !== latest).map(toVersion),
      sendableToModel: mayUse(states, 'model'),
      usableInMaterials: mayUse(states, 'materials'),
      sensitive: sensitiveData(latest.body),
    };
  });
  return facts.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
}

async function loadFact(pool: Pool, factId: string): Promise<Fact> {
  const [fact] = await loadFacts(pool, factId);
  if (!fact) throw httpError(404, 'There is no such fact.');
  return fact;
}

export const factRoutes: FastifyPluginAsyncTypebox<FactRoutesOptions> = async (app, { pool }) => {
  app.get('/facts', { schema: { response: { 200: FactsResponseSchema } } }, async () => ({
    facts: await loadFacts(pool),
  }));

  app.post(
    '/facts',
    { schema: { body: AddFactRequestSchema, response: { 201: FactSchema } } },
    async (request, reply) => {
      const { rows } = await pool.query<{ id: string }>(
        `with new_fact as (insert into fact (kind) values ($1) returning id)
         insert into fact_version (fact_id, version, body, source)
         select id, 1, $2, 'manual' from new_fact
         returning fact_id as id`,
        [request.body.kind, request.body.body.trim()],
      );
      return reply.code(201).send(await loadFact(pool, rows[0]!.id));
    },
  );

  app.post(
    '/facts/:id/versions',
    {
      schema: {
        params: IdParamsSchema,
        body: EditFactRequestSchema,
        response: { 201: FactSchema },
      },
    },
    async (request, reply) => {
      const fact = await loadFact(pool, request.params.id);
      const body = request.body.body.trim();
      if (sameText(body, fact.current.body)) throw httpError(409, 'The text has not changed.');
      await pool.query(
        `insert into fact_version (fact_id, version, body, source)
         select $1, max(version) + 1, $2, 'manual' from fact_version where fact_id = $1`,
        [fact.id, body],
      );
      return reply.code(201).send(await loadFact(pool, fact.id));
    },
  );

  app.patch(
    '/fact-versions/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: UpdateFactVersionRequestSchema,
        response: { 200: FactSchema },
      },
    },
    async (request) => {
      const { rows } = await pool.query<{ fact_id: string }>(
        'select fact_id from fact_version where id = $1',
        [request.params.id],
      );
      const factId = rows[0]?.fact_id;
      if (!factId) throw httpError(404, 'There is no such fact version.');
      const fact = await loadFact(pool, factId);
      const current = fact.current;
      if (current.id !== request.params.id) {
        throw httpError(409, 'Only the current version of a fact can change.');
      }
      const { status = current.status, maySendToModel, mayUseInMaterials } = request.body;
      if (!statusChangeAllowed(current.status, status)) {
        throw httpError(409, `A ${current.status} fact cannot become ${status}.`);
      }
      if (maySendToModel && fact.sensitive.length) {
        throw httpError(
          400,
          `This fact contains ${fact.sensitive.join(' and ')}, which never goes to the model provider.`,
        );
      }
      await pool.query(
        `update fact_version set status = $2,
           may_send_to_model = coalesce($3, may_send_to_model),
           may_use_in_materials = coalesce($4, may_use_in_materials)
         where id = $1`,
        [current.id, status, maySendToModel ?? null, mayUseInMaterials ?? null],
      );
      return loadFact(pool, factId);
    },
  );

  app.post(
    '/facts/import',
    { schema: { body: ImportFactsRequestSchema, response: { 200: ImportFactsResponseSchema } } },
    async (request) => {
      const parsed = parseFactsMarkdown(request.body.markdown);
      if (parsed.length === 0) throw httpError(400, 'No facts were found in the Markdown.');
      const tooLong = parsed.find((f) => f.body.length > maxFactLength);
      if (tooLong) {
        throw httpError(
          400,
          `A fact${tooLong.heading ? ` under “${tooLong.heading}”` : ''} is longer than ${maxFactLength} characters.`,
        );
      }

      const known = (await loadFacts(pool)).map((f) => f.current.body);
      const fresh: typeof parsed = [];
      for (const fact of parsed) {
        if ([...known, ...fresh.map((f) => f.body)].some((body) => sameText(body, fact.body))) {
          continue;
        }
        fresh.push(fact);
      }
      if (fresh.length) {
        await pool.query(
          `with incoming as (
             select kind, body, n, gen_random_uuid() as id
             from jsonb_to_recordset($1::jsonb) as t(kind text, body text, n int)
           ),
           new_fact as (
             insert into fact (id, kind, created_at)
             select id, kind, now() + n * interval '1 microsecond' from incoming
           )
           insert into fact_version (fact_id, version, body, source)
           select id, 1, body, 'markdown' from incoming`,
          [JSON.stringify(fresh.map((f, n) => ({ kind: f.kind, body: f.body, n })))],
        );
      }
      return {
        added: fresh.length,
        skipped: parsed.length - fresh.length,
        facts: await loadFacts(pool),
      };
    },
  );
};
