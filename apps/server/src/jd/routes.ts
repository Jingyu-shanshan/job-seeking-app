import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AddRequirementRequestSchema,
  JobDetailSchema,
  ModelUsageSchema,
  PasteJobRequestSchema,
  maxJobTextLength,
  type JobDetail,
  type JobSource,
  type JobSummary,
  type Requirement,
  type Snapshot,
} from '@jsa/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import Type from 'typebox';
import { DiscoveryError, type JobText } from '../discovery/adapter.ts';
import { tidyText } from '../discovery/html.ts';
import { allAdapters, type RateLimiter } from '../discovery/run.ts';
import { httpError } from '../http-error.ts';
import { quoteFinder } from '../rules/quote.ts';
import { sourcesToRequest } from '../rules/sources.ts';
import { catalog, findCatalogEntry } from '../sources/catalog.ts';
import { summariseSnapshot } from './summarise.ts';

// JD 导入与总结（T05）。发现到的职位从来源读取原文，粘贴的职位由用户给出原文，两者都存成不可修改的
// 快照；总结由用户逐个触发，每次最多一次模型请求。与所有 /api 路由一样，需要会话，写请求需要受信的
// Origin（app.ts 的钩子）。

export interface JdRoutesOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  limiter: RateLimiter;
  deepseekApiKey: string | undefined;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });

interface PostingRow {
  title: string;
  company: string | null;
  location: string;
  url: string;
  closed_at: Date | null;
  external_id: string;
  source_id: string;
  catalog_id: string;
  param: string;
  enabled: boolean;
}

interface SnapshotRow {
  id: string;
  captured_at: Date;
  catalog_id: string;
  title: string;
  company: string | null;
  location: string;
  source_url: string;
  body: string;
  earlier: number;
}

interface SummaryRow {
  created_at: Date;
  model: string;
  cost_usd: string;
  responsibilities: JobSummary['responsibilities'];
  fields: JobSummary['fields'];
}

interface RequirementRow {
  id: string;
  body: string;
  quote: string;
  quote_verified: boolean;
  kind: Requirement['kind'];
  origin: Requirement['origin'];
  created_at: Date;
}

/** 一个职位的全部 job_posting，及其来源；最早发现的在前。 */
async function postingsOf(pool: Pool, jobId: string): Promise<PostingRow[]> {
  const { rows } = await pool.query<PostingRow>(
    `select p.title, p.company, p.location, p.url, p.closed_at, p.external_id,
       s.id as source_id, s.catalog_id, s.param, s.enabled
     from job_posting p join source s on s.id = p.source_id
     where p.job_id = $1
     order by p.first_seen_at, p.id`,
    [jobId],
  );
  return rows;
}

/**
 * 能读取该职位原文的来源：仍列出它的、`sourcesToRequest` 允许请求的、有适配器的来源，最早的在前。
 * 与发现运行一样，停用的来源、提醒邮件和粘贴的来源永远不会被请求。
 */
function importSources(postings: PostingRow[]) {
  const open = postings
    .filter((p) => p.closed_at === null)
    .map((p) => ({ ...p, id: p.source_id, catalogId: p.catalog_id }));
  return sourcesToRequest(open, catalog).flatMap(({ source, entry }) => {
    const adapter = allAdapters[entry.id];
    return adapter ? [{ posting: source, entry, adapter }] : [];
  });
}

/** 一个职位的详情：来源上的标题等信息、当前的快照及其总结和要求。没有这个职位时为 undefined。 */
async function loadJobDetail(pool: Pool, jobId: string): Promise<JobDetail | undefined> {
  const postings = await postingsOf(pool, jobId);
  const snapshots = await pool.query<SnapshotRow>(
    `select id, captured_at, catalog_id, title, company, location, source_url, body,
       (count(*) over () - 1)::int as earlier
     from job_snapshot where job_id = $1
     order by last_captured_at desc, captured_at desc
     limit 1`,
    [jobId],
  );
  const current = snapshots.rows[0];
  // 发现到的职位按最早发现、仍在使用的那条描述（与职位列表一致），粘贴的职位按当前快照描述。
  const first = postings.find((p) => p.closed_at === null && p.enabled) ?? postings[0];
  const head = first
    ? { title: first.title, company: first.company, location: first.location, url: first.url }
    : current && {
        title: current.title,
        company: current.company,
        location: current.location,
        url: current.source_url,
      };
  if (!head) return undefined;

  const sources: JobSource[] = postings
    .filter((p) => p.closed_at === null && p.enabled && findCatalogEntry(p.catalog_id))
    .map((p) => ({ id: p.source_id, catalogId: p.catalog_id, param: p.param }));

  return {
    id: jobId,
    ...head,
    sources,
    canImport: importSources(postings).length > 0,
    snapshot: current ? await loadSnapshot(pool, current) : null,
    earlierSnapshots: current?.earlier ?? 0,
  };
}

async function loadSnapshot(pool: Pool, row: SnapshotRow): Promise<Snapshot> {
  const [summaries, requirements] = await Promise.all([
    pool.query<SummaryRow>(
      `select s.created_at, c.model, c.cost_usd, s.responsibilities, s.fields
       from job_summary s join model_call c on c.id = s.model_call_id
       where s.job_snapshot_id = $1`,
      [row.id],
    ),
    pool.query<RequirementRow>(
      `select id, body, quote, quote_verified, kind, origin, created_at from job_requirement
       where job_snapshot_id = $1 and removed_at is null`,
      [row.id],
    ),
  ]);
  const summary = summaries.rows[0];

  // 按引用在原文中的位置排列，与原文的顺序一致；校验不过的排在最后。
  const find = quoteFinder(row.body);
  const position = (r: RequirementRow) => {
    const at = r.quote_verified ? find(r.quote) : -1;
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  const ordered = requirements.rows
    .map((r) => ({ r, at: position(r) }))
    .sort((a, b) => a.at - b.at || a.r.created_at.getTime() - b.r.created_at.getTime())
    .map(({ r }) => r);

  return {
    id: row.id,
    capturedAt: row.captured_at.toISOString(),
    catalogId: row.catalog_id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.source_url,
    text: row.body,
    summary: summary
      ? {
          createdAt: summary.created_at.toISOString(),
          model: summary.model,
          costUsd: Number(summary.cost_usd),
          responsibilities: summary.responsibilities,
          fields: summary.fields,
        }
      : null,
    requirements: ordered.map((r) => ({
      id: r.id,
      text: r.body,
      quote: r.quote,
      quoteVerified: r.quote_verified,
      kind: r.kind,
      origin: r.origin,
    })),
  };
}

/**
 * 保存一次读到的原文。同一职位已有相同原文的快照时不新增，只记下再次读到的时间，它因此成为当前快照。
 */
async function saveSnapshot(pool: Pool, jobId: string, catalogId: string, job: JobText) {
  await pool.query(
    `insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (job_id, body_sha256) do update set last_captured_at = now()`,
    [jobId, job.text, catalogId, job.title, job.company, job.location, job.url],
  );
}

/** 一个快照所属的职位；没有这个快照时 404。 */
async function jobOfSnapshot(pool: Pool, snapshotId: string): Promise<string> {
  const { rows } = await pool.query<{ job_id: string }>(
    'select job_id from job_snapshot where id = $1',
    [snapshotId],
  );
  const row = rows[0];
  if (!row) throw httpError(404, 'There is no such job text.');
  return row.job_id;
}

/** 写操作之后返回职位的最新详情。 */
async function detailAfterChange(pool: Pool, jobId: string): Promise<JobDetail> {
  const detail = await loadJobDetail(pool, jobId);
  if (!detail) throw new Error(`job ${jobId} has neither postings nor snapshots`);
  return detail;
}

/** 从来源读取一个职位的原文；来源的问题以 502 和用户能看懂的原因返回。 */
async function readFromSource(
  postings: PostingRow[],
  {
    fetch,
    limiter,
    log,
  }: { fetch: typeof globalThis.fetch; limiter: RateLimiter; log: FastifyBaseLogger },
) {
  const [source] = importSources(postings);
  if (!source) {
    throw httpError(
      409,
      'None of the sources you use lists this job now, so the app cannot read its text.',
    );
  }
  const { posting, entry, adapter } = source;
  if (entry.rateLimit) await limiter.wait(entry.id, entry.rateLimit);
  try {
    return {
      catalogId: entry.id,
      job: await adapter.readJob(posting.param, posting.external_id, fetch),
    };
  } catch (err) {
    if (!(err instanceof DiscoveryError)) throw err;
    log.warn({ err, sourceId: posting.source_id }, 'reading a job text failed');
    throw httpError(502, err.message);
  }
}

export const jdRoutes: FastifyPluginAsyncTypebox<JdRoutesOptions> = async (
  app,
  { pool, fetch, limiter, deepseekApiKey },
) => {
  // 正在总结的快照：同一快照同时只发一次模型请求，避免重复计费。
  const summarising = new Set<string>();

  app.get(
    '/jobs/:id',
    { schema: { params: IdParamsSchema, response: { 200: JobDetailSchema } } },
    async (request) => {
      const detail = await loadJobDetail(pool, request.params.id);
      if (!detail) throw httpError(404, 'There is no such job.');
      return detail;
    },
  );

  // 粘贴一个职位：新建职位和它的第一个快照。
  app.post(
    '/jobs',
    { schema: { body: PasteJobRequestSchema, response: { 201: JobDetailSchema } } },
    async (request, reply) => {
      const { title, company, location, url, text } = request.body;
      if (!URL.canParse(url)) throw httpError(400, 'The link is not a valid https address.');
      const body = tidyText(text);
      if (body === '') throw httpError(400, 'Paste the job text.');
      if (body.length > maxJobTextLength) {
        throw httpError(400, `The job text is longer than ${maxJobTextLength} characters.`);
      }
      const { rows } = await pool.query<{ job_id: string }>(
        `with new_job as (insert into job default values returning id)
         insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
         select id, $1, 'paste', $2, $3, $4, $5 from new_job
         returning job_id`,
        [body, title.trim(), company?.trim() || null, location?.trim() ?? '', new URL(url).href],
      );
      return reply.code(201).send(await detailAfterChange(pool, rows[0]!.job_id));
    },
  );

  // 从来源读取一个发现到的职位的当前原文。原文没变时不新增快照。
  app.post(
    '/jobs/:id/snapshots',
    { schema: { params: IdParamsSchema, response: { 200: JobDetailSchema } } },
    async (request) => {
      const jobId = request.params.id;
      const exists = await pool.query('select 1 from job where id = $1', [jobId]);
      if (!exists.rowCount) throw httpError(404, 'There is no such job.');
      const postings = await postingsOf(pool, jobId);
      const { catalogId, job } = await readFromSource(postings, {
        fetch,
        limiter,
        log: request.log,
      });
      await saveSnapshot(pool, jobId, catalogId, job);
      return detailAfterChange(pool, jobId);
    },
  );

  // 用 DeepSeek 总结一个快照：一次请求，结果不可修改，每个快照最多一份。
  app.post(
    '/snapshots/:id/summary',
    { schema: { params: IdParamsSchema, response: { 200: JobDetailSchema } } },
    async (request) => {
      const snapshotId = request.params.id;
      const jobId = await jobOfSnapshot(pool, snapshotId);
      if (!deepseekApiKey) {
        throw httpError(
          503,
          'DEEPSEEK_API_KEY is not set on the server, so jobs cannot be summarised.',
        );
      }
      if (summarising.has(snapshotId)) {
        throw httpError(409, 'This job text is already being summarised. Wait for that to finish.');
      }
      summarising.add(snapshotId);
      try {
        await summariseSnapshot({
          pool,
          fetch,
          apiKey: deepseekApiKey,
          log: request.log,
          snapshotId,
        });
      } finally {
        summarising.delete(snapshotId);
      }
      return detailAfterChange(pool, jobId);
    },
  );

  // 用户添加一条要求；给出 `replaces` 时同时移除那一条，即更正。引用同样做子串校验。
  app.post(
    '/snapshots/:id/requirements',
    {
      schema: {
        params: IdParamsSchema,
        body: AddRequirementRequestSchema,
        response: { 201: JobDetailSchema },
      },
    },
    async (request, reply) => {
      const snapshotId = request.params.id;
      const { text, quote, kind, replaces } = request.body;
      const { rows } = await pool.query<{ job_id: string; body: string }>(
        'select job_id, body from job_snapshot where id = $1',
        [snapshotId],
      );
      const snapshot = rows[0];
      if (!snapshot) throw httpError(404, 'There is no such job text.');
      const verified = quoteFinder(snapshot.body)(quote) >= 0;
      const added = await pool.query(
        `with removed as (
           update job_requirement set removed_at = now()
           where id = $6 and job_snapshot_id = $1 and removed_at is null
           returning id
         )
         insert into job_requirement (job_snapshot_id, body, quote, quote_verified, kind, origin)
         select $1, $2, $3, $4, $5, 'user'
         where $6::uuid is null or exists (select 1 from removed)`,
        [snapshotId, text.trim(), quote.trim(), verified, kind, replaces ?? null],
      );
      if (!added.rowCount) throw httpError(404, 'There is no such requirement.');
      return reply.code(201).send(await detailAfterChange(pool, snapshot.job_id));
    },
  );

  // 移除一条要求。它不会被删除：以后引用它的匹配仍能读到当时的内容。
  app.delete(
    '/requirements/:id',
    { schema: { params: IdParamsSchema, response: { 200: JobDetailSchema } } },
    async (request) => {
      const { rows } = await pool.query<{ job_id: string }>(
        `update job_requirement r set removed_at = now()
         from job_snapshot s
         where r.id = $1 and r.removed_at is null and s.id = r.job_snapshot_id
         returning s.job_id`,
        [request.params.id],
      );
      const row = rows[0];
      if (!row) throw httpError(404, 'There is no such requirement.');
      return detailAfterChange(pool, row.job_id);
    },
  );

  app.get('/model-usage', { schema: { response: { 200: ModelUsageSchema } } }, async () => {
    const { rows } = await pool.query<{
      calls: number;
      failed: number;
      cost_usd: string;
      input_tokens: number;
      output_tokens: number;
    }>(
      `select count(*)::int as calls,
         (count(*) filter (where failure_reason is not null))::int as failed,
         coalesce(sum(cost_usd), 0) as cost_usd,
         coalesce(sum(input_tokens), 0)::int as input_tokens,
         coalesce(sum(output_tokens), 0)::int as output_tokens
       from model_call`,
    );
    const row = rows[0]!;
    return {
      calls: row.calls,
      failed: row.failed,
      costUsd: Number(row.cost_usd),
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    };
  });
};
