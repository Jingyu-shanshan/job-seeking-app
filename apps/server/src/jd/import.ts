import type { DuplicateJob, DuplicateJobResponse, PasteJobRequest } from '@jsa/shared';
import type { Pool, PoolClient } from 'pg';
import { httpError } from '../http-error.ts';
import { jobPageAddress } from '../rules/job-page.ts';
import { sameJobKey } from '../rules/same-job.ts';
import { checkJobText } from './job-text.ts';

function address(url: string): string | undefined {
  const parsed = jobPageAddress(url);
  return 'url' in parsed ? parsed.url : undefined;
}

export async function findDuplicateJobs(
  db: Pool | PoolClient,
  input: { url: string; requestedUrl?: string; title?: string; company?: string | null },
): Promise<DuplicateJob[]> {
  const { rows } = await db.query<DuplicateJob & { url: string | null }>(
    `select j.id,
       case when d.job_id is not null then d.title else l.title end as title,
       case when d.job_id is not null then d.company else l.company end as company,
       case when d.job_id is not null then d.location else l.location end as location,
       l.url
     from (
       select p.job_id, p.title, p.company, p.location, p.url,
         case when p.closed_at is null and s.enabled then 0 else 3 end as priority,
         p.first_seen_at as first_at, null::timestamptz as last_at,
         null::timestamptz as captured_at, p.id
         from job_posting p join source s on s.id=p.source_id
       union all select job_id, title, company, location, url,
         1, null, last_saved_at, null, id from saved_job
       union all select a.job_id, a.title, a.company, a.location, a.url,
         2, a.first_seen_at, null, null, a.id
         from alert_job a join source s on s.id=a.source_id where s.enabled
       union all select job_id, title, company, location, source_url,
         4, null, last_captured_at, captured_at, id from job_snapshot
       union all select job_id, title, company, location, url,
         -1, null, null, null, job_id from job_details
       union all select n.job_id, n.title, n.company, n.location, u.url,
         5, null, r.read_at, null, r.id
         from job_reading r join job_snapshot n on n.id=r.job_snapshot_id
         cross join lateral (values (r.requested_url), (r.resolved_url)) u(url)
     ) l join job j on j.id=l.job_id left join job_details d on d.job_id=j.id
     where j.deleted_at is null
     order by j.id, l.priority, l.first_at, l.last_at desc, l.captured_at desc, l.id`,
  );
  const urls = new Set(
    [address(input.url), input.requestedUrl ? address(input.requestedUrl) : undefined].filter(
      Boolean,
    ),
  );
  const key = sameJobKey(input.company ?? null, input.title ?? '');
  // Match current names and show current details; retain every historical URL as an alias.
  const current = new Map<string, DuplicateJob>();
  for (const row of rows) {
    if (!current.has(row.id))
      current.set(row.id, {
        id: row.id,
        title: row.title,
        company: row.company,
        location: row.location,
      });
  }
  const byUrl = new Map<string, DuplicateJob>();
  const byName = new Map<string, DuplicateJob>();
  for (const { id, url } of rows) {
    const job = current.get(id)!;
    if (url && urls.has(address(url))) byUrl.set(job.id, job);
    if (key && sameJobKey(job.company, job.title) === key) byName.set(job.id, job);
  }
  return [...(byUrl.size ? byUrl : byName).values()];
}

export function duplicateJobResponse(jobs: DuplicateJob[]): DuplicateJobResponse {
  return { code: 'duplicate_job', message: 'This job is already added.', jobs };
}

export async function importJob(
  pool: Pool,
  page: PasteJobRequest,
  catalogId: 'paste' | 'company_page' | 'greenhouse_board' | 'ashby_board',
  options: { createNew?: boolean; requestedUrl?: string } = {},
): Promise<{ jobId: string } | DuplicateJobResponse> {
  const url = address(page.url);
  if (!url) throw httpError(400, 'Enter a valid https job link without a user name or password.');
  if (url.length > 2000) throw httpError(400, 'The job link is too long. Use a shorter link.');
  const text = checkJobText(page.text, 'Paste the job text.');
  const client = await pool.connect();
  const onError = () => {};
  client.on('error', onError);
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtextextended('web-job-import', 0))");
    if (!options.createNew) {
      const duplicates = await findDuplicateJobs(client, {
        ...page,
        requestedUrl: options.requestedUrl,
      });
      if (duplicates.length) {
        await client.query('commit');
        return duplicateJobResponse(duplicates);
      }
    }
    // A deleted saved URL remains reserved; importing it again creates an independent snapshot.
    const occupied = await client.query('select 1 from saved_job where url=$1', [url]);
    const {
      rows: [row],
    } = await client.query<{ job_id: string; id: string }>(
      `with new_job as (insert into job default values returning id)
       insert into job_snapshot(job_id,body,catalog_id,title,company,location,source_url)
       select id,$1,$2,$3,$4,$5,$6 from new_job returning job_id,id`,
      [
        text,
        catalogId,
        page.title.trim(),
        page.company?.trim() || null,
        page.location?.trim() ?? '',
        url,
      ],
    );
    const jobId = row!.job_id;
    if (catalogId !== 'paste') {
      if (!options.createNew && !occupied.rowCount) {
        await client.query(
          `insert into saved_job(job_id,url,title,company,location) values($1,$2,$3,$4,$5)`,
          [
            jobId,
            url,
            page.title.trim(),
            page.company?.trim() || null,
            page.location?.trim() ?? '',
          ],
        );
      }
      if (options.requestedUrl) {
        await client.query(
          `insert into job_reading(job_snapshot_id,requested_url,resolved_url,method)
          values($1,$2,$3,$4)`,
          [row!.id, options.requestedUrl, page.url, catalogId],
        );
      }
    }
    await client.query('commit');
    return { jobId };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.off('error', onError);
    client.release();
  }
}
