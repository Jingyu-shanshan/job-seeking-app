import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AddFactRequestSchema,
  EditFactRequestSchema,
  FactKindSchema,
  FactSchema,
  FactsResponseSchema,
  ImportFactsRequestSchema,
  ImportFactsResponseSchema,
  PreviewFactsMarkdownRequestSchema,
  PreviewFactsResponseSchema,
  SaveFactCandidatesRequestSchema,
  SaveFactCandidatesResponseSchema,
  UpdateFactVersionRequestSchema,
  maxFactLength,
  maxFactImportCandidates,
  maxFactImportTextLength,
  maxPdfBytes,
  type FactCandidate,
  type SaveFactCandidatesResponse,
  type Fact,
  type FactKind,
  type FactStatus,
  type FactVersion,
} from '@jsa/shared';
import { factDuplicates } from '@jsa/shared/fact-import';
import type { Pool, PoolClient } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { currentVersion, mayUse, sensitiveData, statusChangeAllowed } from '../rules/facts.ts';
import { parseFactsMarkdown } from './markdown.ts';
import { previewPdf } from './pdf.ts';

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

export async function loadFacts(pool: Pool | PoolClient, factId?: string): Promise<Fact[]> {
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

function checkCandidates(candidates: readonly FactCandidate[]) {
  if (candidates.length > maxFactImportCandidates)
    throw httpError(400, `An import can have at most ${maxFactImportCandidates} candidates.`);
  if (candidates.reduce((sum, f) => sum + f.body.length, 0) > maxFactImportTextLength)
    throw httpError(400, `An import can have at most ${maxFactImportTextLength} text characters.`);
  for (const f of candidates) {
    if (!f.selected) continue;
    if (!f.body.trim()) throw httpError(400, 'A selected fact cannot be blank.');
    if (f.body.length > maxFactLength)
      throw httpError(
        400,
        `A selected fact is longer than ${maxFactLength} characters. Split it or leave it out.`,
      );
  }
}

/** Both the old Markdown endpoint and reviewed candidates use one atomic, retry-safe writer. */
async function saveCandidates(
  pool: Pool,
  candidates: FactCandidate[],
  legacyMarkdown = false,
): Promise<SaveFactCandidatesResponse> {
  checkCandidates(candidates);
  const client = await pool.connect();
  const connectionLost = () => {};
  client.on('error', connectionLost);
  try {
    await client.query('begin');
    // Serialize imports with facts and edits so the current-body duplicate check cannot race a write.
    await client.query('lock table fact, fact_version in share row exclusive mode');
    const duplicates = factDuplicates(candidates, await loadFacts(client));
    const fresh = candidates.filter((f, i) => f.selected && !duplicates[i]);
    if (fresh.length) {
      await client.query(
        `with incoming as (
           select kind, body, source, n, gen_random_uuid() as id
           from jsonb_to_recordset($1::jsonb) as t(kind text, body text, source text, n int)
         ), new_fact as (
           insert into fact (id, kind, created_at)
           select id, kind, now() + n * interval '1 microsecond' from incoming
         )
         insert into fact_version (fact_id, version, body, source)
         select id, 1, body, source from incoming`,
        [
          JSON.stringify(
            fresh.map((f, n) => ({
              kind: f.kind,
              body: f.body,
              source: legacyMarkdown ? 'markdown' : JSON.stringify(f.source),
              n,
            })),
          ),
        ],
      );
    }
    const facts = await loadFacts(client);
    await client.query('commit');
    return {
      added: fresh.length,
      skipped: duplicates.filter(Boolean).length,
      cancelled: candidates.filter((f, i) => !f.selected && !duplicates[i]).length,
      duplicates: duplicates.flatMap((d, index) => (d ? [{ index, ...d }] : [])),
      facts,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.off('error', connectionLost);
    client.release();
  }
}

function markdownCandidates(markdown: string, fileName = ''): FactCandidate[] {
  const source = {
    type: 'markdown' as const,
    fileName,
    sha256: createHash('sha256').update(markdown).digest('hex'),
    edited: false,
  };
  const candidates = parseFactsMarkdown(markdown).map((f) => ({
    kind: f.kind,
    body: f.body,
    source,
    selected: true,
  }));
  if (!candidates.length) throw httpError(400, 'No facts were found in the Markdown.');
  if (candidates.length > maxFactImportCandidates || markdown.length > maxFactImportTextLength)
    throw httpError(
      400,
      `Use at most ${maxFactImportTextLength} characters and ${maxFactImportCandidates} candidates.`,
    );
  return candidates;
}

export const factRoutes: FastifyPluginAsyncTypebox<FactRoutesOptions> = async (app, { pool }) => {
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: maxPdfBytes },
    (_request, body, done) => done(null, body),
  );
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
    '/facts/import/preview/markdown',
    {
      schema: {
        body: PreviewFactsMarkdownRequestSchema,
        response: { 200: PreviewFactsResponseSchema },
      },
    },
    async (request) => {
      const candidates = markdownCandidates(request.body.markdown, request.body.fileName);
      const duplicates = factDuplicates(candidates, await loadFacts(pool));
      return {
        pages: [],
        candidates: candidates.map((c, i) => ({
          ...c,
          selected: !duplicates[i],
          duplicate: duplicates[i] ?? null,
        })),
      };
    },
  );
  app.post(
    '/facts/import/preview/pdf',
    {
      bodyLimit: maxPdfBytes,
      schema: {
        querystring: Type.Object({
          fileName: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^\\u0000-\\u001f]+$' }),
        }),
        response: { 200: PreviewFactsResponseSchema },
      },
    },
    async (request) => {
      if (!Buffer.isBuffer(request.body))
        throw httpError(400, 'Upload PDF bytes with application/pdf.');
      const preview = await previewPdf(request.body, request.query.fileName);
      const duplicates = factDuplicates(preview.candidates, await loadFacts(pool));
      return {
        ...preview,
        candidates: preview.candidates.map((c, i) => ({
          ...c,
          selected: !duplicates[i],
          duplicate: duplicates[i] ?? null,
        })),
      };
    },
  );
  app.post(
    '/facts/import/candidates',
    {
      bodyLimit: maxPdfBytes,
      schema: {
        body: SaveFactCandidatesRequestSchema,
        response: { 200: SaveFactCandidatesResponseSchema },
      },
    },
    (request) => saveCandidates(pool, request.body.candidates),
  );
  app.post(
    '/facts/import',
    { schema: { body: ImportFactsRequestSchema, response: { 200: ImportFactsResponseSchema } } },
    async (request) => {
      return saveCandidates(pool, markdownCandidates(request.body.markdown), true);
    },
  );
};
