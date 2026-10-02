import Type from 'typebox';
import { Value } from 'typebox/value';
import { DiscoveryError, fetchJson, httpsUrl, type Adapter } from './adapter.ts';

// Greenhouse's public Job Board API (https://docs.greenhouse.io/job-board.html, checked
// 2026-10-01): one request lists every published job of a board. No key, no login. Board names
// are not case-sensitive. Only the fields the app uses are checked; others are ignored. The job
// text (`?content=true`) is not requested here: it goes into a JD snapshot in T05.

const BoardSchema = Type.Object({
  jobs: Type.Array(
    Type.Object({
      id: Type.Integer({ minimum: 1 }),
      title: Type.String({ pattern: '\\S', maxLength: 1000 }),
      company_name: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
      location: Type.Optional(
        Type.Union([
          Type.Object({ name: Type.Union([Type.String({ maxLength: 5000 }), Type.Null()]) }),
          Type.Null(),
        ]),
      ),
      absolute_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      first_published: Type.Optional(
        Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      ),
    }),
    { maxItems: 10_000 },
  ),
});

export const greenhouseBoard: Adapter = async (board, fetch) => {
  const name = encodeURIComponent(board);
  let body: unknown;
  try {
    body = await fetchJson(fetch, `https://boards-api.greenhouse.io/v1/boards/${name}/jobs`);
  } catch (err) {
    if (err instanceof DiscoveryError && err.status === 404) {
      throw new DiscoveryError(`Greenhouse has no job board called ${board}.`);
    }
    throw err;
  }
  if (!Value.Check(BoardSchema, body)) {
    throw new DiscoveryError('Greenhouse answered with something other than a list of jobs.');
  }
  return body.jobs.map((job) => ({
    externalId: String(job.id),
    title: job.title.trim(),
    company: job.company_name?.trim() || null,
    location: job.location?.name?.trim() ?? '',
    // Usually the board's page; some companies point it at their own careers site.
    url: httpsUrl(job.absolute_url) ?? `https://job-boards.greenhouse.io/${name}/jobs/${job.id}`,
    publishedAt: job.first_published ?? null,
  }));
};
