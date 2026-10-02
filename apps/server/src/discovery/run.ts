import { setTimeout as sleep } from 'node:timers/promises';
import type { CatalogEntry, DiscoveryRun, SourceRun } from '@jsa/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { sourcesToRequest } from '../rules/sources.ts';
import { catalog } from '../sources/catalog.ts';
import { DiscoveryError, type Adapter, type Posting } from './adapter.ts';
import { ashbyBoard } from './ashby.ts';
import { greenhouseBoard } from './greenhouse.ts';

/** Adapters by catalog entry id. A source of an entry without one is skipped and reported. */
export const allAdapters: Partial<Record<string, Adapter>> = {
  greenhouse_board: greenhouseBoard,
  ashby_board: ashbyBoard,
};

/** Requests one run may send, however many sources are in use (T13). */
export const defaultRequestLimit = 20;

type RateLimit = NonNullable<CatalogEntry['rateLimit']>;

/**
 * Spaces requests per site so that none goes over the catalog entry's limit. One instance lives
 * as long as the server, so back-to-back runs share it.
 * 发现运行和读取职位原文（T05）共用同一个实例；同一网站的请求按调用顺序排队，所以并发调用也不会超限。
 */
export class RateLimiter {
  readonly #sent = new Map<string, number[]>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<unknown>;

  constructor({
    now = Date.now,
    sleep: wait = (ms: number) => sleep(ms),
  }: { now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}) {
    this.#now = now;
    this.#sleep = wait;
  }

  /** Waits until one more request to `site` is within `limit`, then counts it as sent. */
  wait(site: string, limit: RateLimit): Promise<void> {
    const turn = (this.#queues.get(site) ?? Promise.resolve()).then(() => this.#take(site, limit));
    this.#queues.set(site, turn);
    return turn;
  }

  async #take(site: string, { requests, perSeconds }: RateLimit) {
    const sent = this.#sent.get(site) ?? [];
    const oldest = sent.length >= requests ? sent[sent.length - requests] : undefined;
    if (oldest !== undefined) {
      const delay = oldest + perSeconds * 1000 - this.#now();
      if (delay > 0) await this.#sleep(delay);
    }
    this.#sent.set(site, [...sent, this.#now()].slice(-requests));
  }
}

export interface RunOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  limiter: RateLimiter;
  log: FastifyBaseLogger;
  requestLimit?: number;
  /** For tests; every catalog entry the app requests has one. */
  adapters?: Partial<Record<string, Adapter>>;
}

interface SourceRow {
  id: string;
  catalog_id: string;
  param: string;
  enabled: boolean;
}

/**
 * Reads every source a run may request (`sourcesToRequest`), the least recently tried first, and
 * records each one's postings and result. A source that fails keeps the jobs it listed before.
 * The run never adds sources and never looks at the search scope.
 */
export async function runDiscovery({
  pool,
  fetch,
  limiter,
  log,
  requestLimit = defaultRequestLimit,
  adapters = allAdapters,
}: RunOptions): Promise<DiscoveryRun> {
  const { rows } = await pool.query<SourceRow>(
    `select id, catalog_id, param, enabled from source
     order by greatest(last_success_at, last_failure_at) nulls first, catalog_id, param`,
  );
  const settings = rows.map((row) => ({ ...row, catalogId: row.catalog_id }));

  let requests = 0;
  const results: SourceRun[] = [];
  for (const { source, entry } of sourcesToRequest(settings, catalog)) {
    const result = {
      sourceId: source.id,
      catalogId: entry.id,
      name: entry.name,
      param: source.param,
      found: 0,
      added: 0,
      closed: 0,
    };
    const adapter = adapters[entry.id];
    if (!adapter) {
      results.push({ ...result, outcome: 'skipped', reason: 'The app cannot read these yet.' });
      continue;
    }
    if (requests >= requestLimit) {
      results.push({
        ...result,
        outcome: 'skipped',
        reason: `The run reached its limit of ${requestLimit} requests.`,
      });
      continue;
    }

    if (entry.rateLimit) await limiter.wait(entry.id, entry.rateLimit);
    requests += 1;
    try {
      const postings = await adapter.listJobs(source.param, fetch);
      const counts = await savePostings(pool, source.id, entry.id, postings);
      results.push({ ...result, ...counts, outcome: 'ok', reason: '' });
    } catch (err) {
      const expected = err instanceof DiscoveryError;
      log[expected ? 'warn' : 'error']({ err, sourceId: source.id }, 'discovery source failed');
      const reason = expected ? err.message : 'Something went wrong; the server log has details.';
      await pool.query(
        'update source set last_failure_at = now(), last_failure_reason = $2 where id = $1',
        [source.id, reason.slice(0, 1000)],
      );
      results.push({ ...result, outcome: 'failed', reason });
    }
  }
  return { requests, requestLimit, sources: results };
}

/**
 * Records what one successful read of a source listed, in one statement: new postings (with a
 * new job unless the same posting is known through another source of the same catalog entry),
 * refreshed ones, and closes the source's open postings it no longer lists.
 */
async function savePostings(
  pool: Pool,
  sourceId: string,
  catalogId: string,
  postings: Posting[],
): Promise<{ found: number; added: number; closed: number }> {
  // A source that lists one posting twice still has it once.
  const unique = [...new Map(postings.map((p) => [p.externalId, p])).values()];
  const { rows } = await pool.query<{ found: number; added: number; closed: number }>(
    `with incoming as (
       select * from jsonb_to_recordset($3::jsonb) as t(
         external_id text, title text, company text, location text, url text,
         published_at timestamptz)
     ),
     known as (
       select distinct on (p.external_id) p.external_id, p.job_id
       from job_posting p join source s on s.id = p.source_id
       where s.catalog_id = $2 and p.external_id in (select external_id from incoming)
       order by p.external_id, p.first_seen_at
     ),
     fresh as (
       select external_id, gen_random_uuid() as job_id from incoming
       where external_id not in (select external_id from known)
     ),
     new_job as (
       insert into job (id) select job_id from fresh
     ),
     saved as (
       insert into job_posting
         (source_id, job_id, external_id, title, company, location, url, published_at)
       select $1, coalesce(k.job_id, f.job_id), i.external_id, i.title, i.company, i.location,
         i.url, i.published_at
       from incoming i left join known k using (external_id) left join fresh f using (external_id)
       on conflict (source_id, external_id) do update set
         title = excluded.title, company = excluded.company, location = excluded.location,
         url = excluded.url, published_at = excluded.published_at,
         last_seen_at = now(), closed_at = null
     ),
     closed as (
       update job_posting set closed_at = now()
       where source_id = $1 and closed_at is null
         and external_id not in (select external_id from incoming)
       returning 1
     ),
     succeeded as (
       update source set last_success_at = now() where id = $1
     )
     select
       (select count(*) from incoming)::int as found,
       (select count(*) from fresh)::int as added,
       (select count(*) from closed)::int as closed`,
    [
      sourceId,
      catalogId,
      JSON.stringify(
        unique.map((p) => ({
          external_id: p.externalId,
          title: p.title,
          company: p.company,
          location: p.location,
          url: p.url,
          published_at: p.publishedAt,
        })),
      ),
    ],
  );
  return rows[0]!;
}
