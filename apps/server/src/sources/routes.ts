import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AddSourceRequestSchema,
  SourceSchema,
  SourcesResponseSchema,
  UpdateSourceRequestSchema,
  type Source,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { catalog, findCatalogEntry } from './catalog.ts';

// The user's sources (T15); the search scope is one of the criteria since T06
// (matching/criteria.ts). Nothing here requests a source; discovery (T13) does that, and only for
// what `sourcesToRequest` in rules/sources.ts returns. Like every /api route, these need a session
// and, for writes, a trusted Origin (the hook in app.ts).

export interface SourceRoutesOptions {
  pool: Pool;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

const columns =
  'id, catalog_id, param, enabled, last_success_at, last_failure_at, last_failure_reason';

interface SourceRow {
  id: string;
  catalog_id: string;
  param: string;
  enabled: boolean;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_failure_reason: string | null;
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    param: row.param,
    enabled: row.enabled,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    lastFailureReason: row.last_failure_reason,
  };
}

export const sourceRoutes: FastifyPluginAsyncTypebox<SourceRoutesOptions> = async (
  app,
  { pool },
) => {
  app.get('/sources', { schema: { response: { 200: SourcesResponseSchema } } }, async () => {
    const { rows } = await pool.query<SourceRow>(
      `select ${columns} from source order by catalog_id, param`,
    );
    // A source whose entry has left the catalog is not shown, and never requested either.
    const sources = rows.filter((row) => findCatalogEntry(row.catalog_id)).map(toSource);
    return { catalog: [...catalog], sources };
  });

  app.post(
    '/sources',
    { schema: { body: AddSourceRequestSchema, response: { 201: SourceSchema } } },
    async (request, reply) => {
      const { catalogId } = request.body;
      const param = request.body.param?.trim() ?? '';
      const entry = findCatalogEntry(catalogId);
      if (!entry) throw httpError(400, `There is no catalog entry ${catalogId}.`);
      if (entry.access === 'manual') {
        throw httpError(400, `${entry.name} is always available and is not added as a source.`);
      }
      if (entry.param && !new RegExp(entry.param.pattern).test(param)) {
        throw httpError(400, `${entry.param.label} is not valid. ${entry.param.hint}`);
      }
      if (!entry.param && param !== '') {
        throw httpError(400, `${entry.name} takes no parameter.`);
      }

      const { rows } = await pool.query<SourceRow>(
        `insert into source (catalog_id, param) values ($1, $2)
         on conflict (catalog_id, param) do nothing returning ${columns}`,
        [catalogId, param],
      );
      const row = rows[0];
      if (!row) {
        throw httpError(
          409,
          entry.param
            ? `${entry.name}: ${param} has already been added.`
            : `${entry.name} has already been added.`,
        );
      }
      return reply.code(201).send(toSource(row));
    },
  );

  app.patch(
    '/sources/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: UpdateSourceRequestSchema,
        response: { 200: SourceSchema },
      },
    },
    async (request) => {
      const { rows } = await pool.query<SourceRow>(
        `update source set enabled = $2 where id = $1 returning ${columns}`,
        [request.params.id, request.body.enabled],
      );
      const row = rows[0];
      if (!row) throw httpError(404, 'There is no such source.');
      return toSource(row);
    },
  );

  app.delete('/sources/:id', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const { rowCount } = await pool.query('delete from source where id = $1', [request.params.id]);
    if (!rowCount) throw httpError(404, 'There is no such source.');
    return reply.code(204).send();
  });
};
