import type { Run, RunConfig, RunPreset } from '@jsa/shared';
import type { Pool } from 'pg';
import { httpError } from '../http-error.ts';
import { loadCriteria } from '../matching/criteria.ts';

export interface RunRow {
  id: string;
  preset_id: string | null;
  config: RunConfig;
  criteria: Run['criteria'];
  sources: Run['sources'];
  status: Run['status'];
  message: string;
  created_at: Date;
  requests: number;
  materials: number;
  submissions: number;
  cost_usd: string;
  elapsed: string;
}
export async function loadRun(pool: Pool, id: string): Promise<Run> {
  const { rows } = await pool.query<RunRow>(
    `select *,
    (elapsed_ms + coalesce(extract(epoch from (now()-active_since))*1000,0)) as elapsed
    from search_run where id=$1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw httpError(404, 'There is no such run.');
  const jobs = await pool.query<{ id: string; title: string; stage: string; message: string }>(
    `
    select j.job_id as id,j.title,coalesce(s.key,'waiting') as stage,coalesce(s.message,'') as message
    from run_job j left join lateral (
      select key,message from run_step where run_id=j.run_id and key like j.job_id::text || '/%'
      order by done, key desc limit 1
    ) s on true where j.run_id=$1 order by j.title,j.job_id`,
    [id],
  );
  return {
    id: r.id,
    presetId: r.preset_id,
    config: r.config,
    criteria: r.criteria,
    sources: r.sources,
    status: r.status,
    message: r.message,
    createdAt: r.created_at.toISOString(),
    requests: r.requests,
    materials: r.materials,
    submissions: r.submissions,
    costUsd: Number(r.cost_usd),
    elapsedSeconds: Number(r.elapsed) / 1000,
    jobs: jobs.rows,
  };
}
export async function presets(pool: Pool): Promise<RunPreset[]> {
  return (await pool.query<RunPreset>('select id,config from run_preset order by id')).rows;
}
export async function createRun(pool: Pool, presetId: string): Promise<string> {
  // Configuration is captured in one transaction so a preset edit cannot mix two versions.
  const client = await pool.connect();
  const onError = () => {};
  client.on('error', onError);
  try {
    await client.query('begin isolation level repeatable read');
    const { rows } = await client.query<RunPreset>('select id,config from run_preset where id=$1', [
      presetId,
    ]);
    const preset = rows[0];
    if (!preset) throw httpError(404, 'There is no such preset.');
    // loadCriteria uses the same query interface as a checked-out connection.
    const criteria = await loadCriteria(client);
    const sources = (
      await client.query<Run['sources'][number]>(
        `select id,catalog_id as "catalogId",param,enabled from source order by id`,
      )
    ).rows;
    const run = await client.query<{ id: string }>(
      `insert into search_run (preset_id,config,criteria,sources)
      values ($1,$2,$3,$4) returning id`,
      [presetId, JSON.stringify(preset.config), JSON.stringify(criteria), JSON.stringify(sources)],
    );
    await client.query(
      `update run_preset set next_at=case when (config->>'intervalHours')::int=0 then null
      else now()+make_interval(hours=>(config->>'intervalHours')::int) end where id=$1`,
      [presetId],
    );
    await client.query('commit');
    return run.rows[0]!.id;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    if ((err as { code?: string }).code === '23505')
      throw httpError(409, 'Another run is queued or running. Stop it first.');
    throw err;
  } finally {
    client.off('error', onError);
    client.release();
  }
}
export async function endRun(pool: Pool, id: string, status: Run['status'], message: string) {
  await pool.query(
    `update search_run set status=$2,message=$3,
    elapsed_ms=elapsed_ms+coalesce(ceil(extract(epoch from(now()-active_since))*1000)::bigint,0),active_since=null
    where id=$1 and status='running'`,
    [id, status, message.slice(0, 1000)],
  );
}
