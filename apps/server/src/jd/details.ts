import type { JobDetails } from '@jsa/shared';
import type { Pool, PoolClient } from 'pg';

export async function loadJobDetails(
  db: Pool | PoolClient,
  jobIds: readonly string[],
): Promise<Map<string, JobDetails>> {
  const { rows } = await db.query<JobDetails & { job_id: string }>(
    'select job_id, title, company, location, url from job_details where job_id = any($1::uuid[])',
    [jobIds],
  );
  return new Map(rows.map(({ job_id, ...details }) => [job_id, details]));
}

export async function canEditJobDetails(db: Pool | PoolClient, jobId: string): Promise<boolean> {
  const { rows } = await db.query<{ editable: boolean }>(
    `select (
       exists (select 1 from saved_job where job_id = j.id)
       or exists (select 1 from alert_job a join source s on s.id = a.source_id
                  where a.job_id = j.id and s.enabled)
       or exists (select 1 from job_snapshot n where n.job_id = j.id and (
         n.catalog_id = 'paste' or (
           n.catalog_id in ('company_page', 'greenhouse_board', 'ashby_board')
           and not exists (select 1 from job_posting p where p.job_id = j.id)
         )
       ))
     ) as editable from job j where j.id = $1 and j.deleted_at is null`,
    [jobId],
  );
  return rows[0]?.editable ?? false;
}
