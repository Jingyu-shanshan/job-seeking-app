import { decodeHTML } from 'entities';
import Type, { type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  DiscoveryError,
  checkJobText,
  fetchJson,
  fitLocation,
  httpsUrl,
  maybe,
  type Adapter,
} from './adapter.ts';
import { htmlToText } from './html.ts';

// Greenhouse's public Job Board API (https://docs.greenhouse.io/job-board.html, checked
// 2026-10-01): one request lists every published job of a board. No key, no login. Board names
// are not case-sensitive. Only the fields the app uses are checked; others are ignored. The job
// text (`?content=true`) is not requested by the list: it goes into a JD snapshot in T05.
// 读取单个职位的原文（T05）用同一接口的 GET /v1/boards/{board}/jobs/{id}：`content` 是经过一次
// HTML 转义的 HTML，所以先解码实体再转成纯文本。

const JobSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  title: Type.String({ pattern: '\\S', maxLength: 1000 }),
  company_name: maybe(Type.String({ maxLength: 1000 })),
  location: maybe(Type.Object({ name: maybe(Type.String()) })),
  absolute_url: maybe(Type.String()),
  first_published: maybe(Type.String({ format: 'date-time' })),
});

const BoardSchema = Type.Object({
  jobs: Type.Array(JobSchema, { maxItems: 10_000 }),
});

const JobWithContentSchema = Type.Intersect([JobSchema, Type.Object({ content: Type.String() })]);

/** 列表和单个职位共用的字段。 */
function describe(name: string, job: Static<typeof JobSchema>) {
  return {
    title: job.title.trim(),
    company: job.company_name?.trim() || null,
    location: fitLocation(job.location?.name?.trim() ?? ''),
    // Usually the board's page; some companies point it at their own careers site.
    url: httpsUrl(job.absolute_url) ?? `https://job-boards.greenhouse.io/${name}/jobs/${job.id}`,
  };
}

/** GET 一个 Greenhouse 地址；404 时用 `notFound` 作为提示。 */
async function get(url: string, fetch: typeof globalThis.fetch, notFound: string) {
  try {
    return await fetchJson(fetch, url);
  } catch (err) {
    if (err instanceof DiscoveryError && err.status === 404) throw new DiscoveryError(notFound);
    throw err;
  }
}

export const greenhouseBoard: Adapter = {
  async listJobs(board, fetch) {
    const name = encodeURIComponent(board);
    const body = await get(
      `https://boards-api.greenhouse.io/v1/boards/${name}/jobs`,
      fetch,
      `Greenhouse has no job board called ${board}.`,
    );
    if (!Value.Check(BoardSchema, body)) {
      throw new DiscoveryError('Greenhouse answered with something other than a list of jobs.');
    }
    return body.jobs.map((job) => ({
      externalId: String(job.id),
      ...describe(name, job),
      publishedAt: job.first_published ?? null,
    }));
  },

  async readJob(board, externalId, fetch) {
    const name = encodeURIComponent(board);
    const body = await get(
      `https://boards-api.greenhouse.io/v1/boards/${name}/jobs/${encodeURIComponent(externalId)}`,
      fetch,
      `The Greenhouse board ${board} no longer lists this job.`,
    );
    if (!Value.Check(JobWithContentSchema, body)) {
      throw new DiscoveryError('Greenhouse answered with something other than a job.');
    }
    return {
      ...describe(name, body),
      text: checkJobText(htmlToText(decodeHTML(body.content)), 'Greenhouse'),
    };
  },
};
