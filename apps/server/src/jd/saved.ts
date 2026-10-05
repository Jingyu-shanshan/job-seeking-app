import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  SavePageRequestSchema,
  SavePageResponseSchema,
  SaveResultsRequestSchema,
  SaveResultsResponseSchema,
} from '@jsa/shared';
import type { Pool } from 'pg';
import { listedJobs } from '../discovery/same-job.ts';
import { httpError } from '../http-error.ts';
import { jobPageAddress } from '../rules/job-page.ts';
import { sameJobKey, uniqueJobs } from '../rules/same-job.ts';
import { checkJobText } from './job-text.ts';

// Saving from the desktop app (T21). When the user clicks, the desktop app reads the page they
// are looking at and sends what it read here; that is untrusted text like any page. A page is
// known by its address (rules/job-page.ts): the same address is the same job, and so is a job a
// discovery run found at that address. Like every /api route, these need a session and a
// trusted Origin (app.ts).

export interface SavedRoutesOptions {
  pool: Pool;
}

function addressOf(url: string) {
  const address = jobPageAddress(url);
  if ('error' in address) throw httpError(400, address.error);
  return address.url;
}

// The job an address (`i.url`) belongs to already: an earlier save of it, a job board posting or
// an alert email's job at that address, or else the one job listed with the same company and
// title (`i.same_job_id`).
const existingJob = `coalesce(
  (select s.job_id from saved_job s where s.url = i.url),
  (select p.job_id from job_posting p where p.url = i.url order by p.first_seen_at, p.id limit 1),
  (select a.job_id from alert_job a where a.url = i.url order by a.first_seen_at, a.id limit 1),
  i.same_job_id
)`;

// Records what the page showed for each address, refreshing an earlier save in place. An address
// the app has no job for gets a new one, with the id the caller chose in `new_id`.
const saveEntries = `
  matched as (select i.url, ${existingJob} as job_id from input i),
  new_jobs as (
    insert into job (id)
    select i.new_id from input i join matched m using (url) where m.job_id is null
  ),
  saved as (
    insert into saved_job (job_id, url, title, company, location)
    select coalesce(m.job_id, i.new_id), i.url, i.title, i.company, i.location
    from input i join matched m using (url)
    on conflict (url) do update set
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      last_saved_at = now()
    returning job_id, url
  )`;

const optional = (text: string | undefined) => text?.trim() || null;

const inputColumns =
  't(url text, title text, company text, location text, new_id uuid, same_job_id uuid)';

/** For each entry, the one job listed elsewhere with the same company and title, if any. */
async function withSameJobs<E extends { title: string; company: string | null }>(
  pool: Pool,
  entries: E[],
): Promise<(E & { same_job_id: string | null })[]> {
  const jobs = uniqueJobs(await listedJobs(pool));
  return entries.map((entry) => {
    const key = sameJobKey(entry.company, entry.title);
    return { ...entry, same_job_id: (key && jobs.get(key)) ?? null };
  });
}

export const savedRoutes: FastifyPluginAsyncTypebox<SavedRoutesOptions> = async (app, { pool }) => {
  // One job page and its text. Saving the same text again only marks it as read again.
  app.post(
    '/saved-pages',
    { schema: { body: SavePageRequestSchema, response: { 200: SavePageResponseSchema } } },
    async (request) => {
      const { url, title, company, location, text } = request.body;
      const entry = {
        url: addressOf(url),
        title: title.trim(),
        company: optional(company),
        location: location?.trim() ?? '',
        new_id: randomUUID(),
      };
      const body = checkJobText(text, 'The page has no text to save.');
      const { rows } = await pool.query<{
        job_id: string;
        new_job: boolean;
        had_text: boolean;
        new_text: boolean;
      }>(
        `with input as (select * from jsonb_to_recordset($1::jsonb) as ${inputColumns}),
         ${saveEntries},
         snapshot as (
           insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
           select s.job_id, $2, 'desktop_save', i.title, i.company, i.location, i.url
           from saved s join input i using (url)
           on conflict (job_id, body_sha256) do update set last_captured_at = now()
           returning (xmax = 0) as inserted
         )
         -- The texts the job had before this statement; the new one is not visible here.
         select s.job_id, m.job_id is null as new_job, n.inserted as new_text,
           exists (select 1 from job_snapshot o where o.job_id = s.job_id) as had_text
         from saved s, matched m, snapshot n`,
        [JSON.stringify(await withSameJobs(pool, [entry])), body],
      );
      const row = rows[0]!;
      return {
        jobId: row.job_id,
        title: entry.title,
        newJob: row.new_job,
        text: !row.new_text ? 'same' : row.had_text ? 'new' : 'first',
      } as const;
    },
  );

  // The job entries a results page showed: list information only, no job text. Entries for the
  // same address count once.
  app.post(
    '/saved-results',
    { schema: { body: SaveResultsRequestSchema, response: { 200: SaveResultsResponseSchema } } },
    async (request) => {
      const entries = new Map<
        string,
        { url: string; title: string; company: string | null; location: string; new_id: string }
      >();
      for (const { url, title, company, location } of request.body.entries) {
        const address = addressOf(url);
        entries.set(address, {
          url: address,
          title: title.trim(),
          company: optional(company),
          location: location?.trim() ?? '',
          new_id: randomUUID(),
        });
      }
      const { rows } = await pool.query<{ saved: number; new_jobs: number }>(
        `with input as (select * from jsonb_to_recordset($1::jsonb) as ${inputColumns}),
         ${saveEntries}
         select (select count(distinct job_id) from saved)::int as saved,
           (select count(*) from matched where job_id is null)::int as new_jobs`,
        [JSON.stringify(await withSameJobs(pool, [...entries.values()]))],
      );
      const row = rows[0]!;
      return { saved: row.saved, newJobs: row.new_jobs };
    },
  );
};
