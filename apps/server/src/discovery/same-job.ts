import type { Pool } from 'pg';
import { sameJobKey } from '../rules/same-job.ts';

// The listings the app has, keyed by company and title (rules/same-job.ts), so that a job seen on
// two sites counts once (T20): an alert email's entry, a page saved in the desktop app and a job
// board's posting of the same job share one `job` row. Pasted jobs are not listings and never
// match: what the user pasted may be anything.

export interface KeyedJob {
  key: string | null;
  jobId: string;
}

/**
 * Open postings of enabled sources (a board without a company name is known by its board name),
 * saved jobs and alert-email jobs. With `listOnly`, only jobs no posting lists, open or not.
 */
export async function listedJobs(pool: Pool, { listOnly = false } = {}): Promise<KeyedJob[]> {
  const unposted = listOnly
    ? 'where not exists (select 1 from job_posting p where p.job_id = l.job_id)'
    : '';
  const { rows } = await pool.query<{ job_id: string; company: string | null; title: string }>(
    `select job_id, company, title from (
       ${
         listOnly
           ? ''
           : `select p.job_id, coalesce(p.company, s.param) as company, p.title
              from job_posting p join source s on s.id = p.source_id
              where p.closed_at is null and s.enabled
              union all`
       }
       select job_id, company, title from saved_job
       union all
       select job_id, company, title from alert_job
     ) l ${unposted}`,
  );
  return rows.map((row) => ({ key: sameJobKey(row.company, row.title), jobId: row.job_id }));
}
