import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { DiscoveryRunSchema, JobsResponseSchema, type Job, type SearchScope } from '@jsa/shared';
import type { Pool } from 'pg';
import { httpError } from '../http-error.ts';
import { classifyLocation } from '../rules/location.ts';
import { findCatalogEntry } from '../sources/catalog.ts';
import { RateLimiter, runDiscovery } from './run.ts';

// Discovery (T13): a run reads the user's sources, and the job list shows what they list now.
// Like every /api route, these need a session and, for writes, a trusted Origin (app.ts).

export interface DiscoveryRoutesOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
}

interface PostingRow {
  job_id: string;
  title: string;
  company: string | null;
  location: string;
  url: string;
  published_at: Date | null;
  first_seen_at: Date;
  source_id: string;
  catalog_id: string;
  param: string;
}

export const discoveryRoutes: FastifyPluginAsyncTypebox<DiscoveryRoutesOptions> = async (
  app,
  { pool, fetch },
) => {
  const limiter = new RateLimiter();
  // One run at a time: the app has one user and runs in one process.
  let running = false;

  // Runs within the request. The request limit and the per-site rate limits bound how long.
  app.post(
    '/discovery-runs',
    { schema: { response: { 200: DiscoveryRunSchema } } },
    async (request) => {
      if (running) throw httpError(409, 'Jobs are already being looked for. Wait for that run.');
      running = true;
      try {
        return await runDiscovery({ pool, fetch, limiter, log: request.log });
      } finally {
        running = false;
      }
    },
  );

  app.get('/jobs', { schema: { response: { 200: JobsResponseSchema } } }, async () => {
    const scopeRows = await pool.query<{ area: SearchScope['area']; include_remote: boolean }>(
      'select area, include_remote from search_scope',
    );
    const scopeRow = scopeRows.rows[0];
    if (!scopeRow) throw new Error('search_scope has no row');
    const scope: SearchScope = { area: scopeRow.area, includeRemote: scopeRow.include_remote };

    // Open postings of sources in use. Postings of a disabled source come back when it is
    // enabled again; a source whose entry left the catalog is never shown.
    const { rows } = await pool.query<PostingRow>(
      `select p.job_id, p.title, p.company, p.location, p.url, p.published_at, p.first_seen_at,
         s.id as source_id, s.catalog_id, s.param
       from job_posting p join source s on s.id = p.source_id
       where p.closed_at is null and s.enabled
       order by p.first_seen_at, p.id`,
    );

    // One entry per job, however many sources list it, described by the first posting found.
    const jobs = new Map<string, Job>();
    for (const row of rows) {
      if (!findCatalogEntry(row.catalog_id)) continue;
      const source = { id: row.source_id, catalogId: row.catalog_id, param: row.param };
      const job = jobs.get(row.job_id);
      if (job) {
        job.sources.push(source);
        continue;
      }
      jobs.set(row.job_id, {
        id: row.job_id,
        title: row.title,
        company: row.company,
        location: row.location,
        url: row.url,
        publishedAt: row.published_at?.toISOString() ?? null,
        firstSeenAt: row.first_seen_at.toISOString(),
        sources: [source],
        ...classifyLocation(row.location, scope),
      });
    }

    // Newest first; jobs without a publication date last.
    const sorted = [...jobs.values()].sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.title.localeCompare(b.title),
    );
    return { scope, jobs: sorted };
  });
};
