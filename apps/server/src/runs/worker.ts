import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { DiscoveryError } from '../discovery/adapter.ts';
import { allAdapters, RateLimiter, savePostings } from '../discovery/run.ts';
import { writeDraft } from '../drafts/write.ts';
import { loadJobDetail, postingsOf, readFromSource, saveSnapshot } from '../jd/routes.ts';
import { summariseSnapshot } from '../jd/summarise.ts';
import { checkJobs } from '../matching/check.ts';
import { matchSnapshot } from '../matching/match.ts';
import { sourcesToRequest } from '../rules/sources.ts';
import { catalog } from '../sources/catalog.ts';
import { BudgetStop, RunBudget } from './budget.ts';
import { endRun, loadRun } from './store.ts';

export interface WorkerOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  limiter: RateLimiter;
  log: FastifyBaseLogger;
  deepseekApiKey: string | undefined;
}
/** A DB advisory lock is held by the caller for the entire worker, across server replicas. */
export async function prepareRun(options: WorkerOptions, id: string, budget: RunBudget) {
  const { pool, limiter, log, deepseekApiKey } = options;
  const run = await loadRun(pool, id);
  const check = async () => {
    const state = await loadRun(pool, id);
    if (state.status !== 'running' || budget.controller.signal.aborted)
      throw new BudgetStop('The run was stopped.');
    if (state.elapsedSeconds >= run.config.timeLimitSeconds)
      throw new BudgetStop('The run reached its time limit.');
  };
  const step = async (key: string, material: boolean, action: () => Promise<void>) => {
    await check();
    const known = await pool.query<{ done: boolean }>(
      'select done from run_step where run_id=$1 and key=$2',
      [id, key],
    );
    if (known.rows[0]?.done) return;
    if (!known.rowCount) {
      const client = await pool.connect();
      const onError = () => {};
      client.on('error', onError);
      try {
        await client.query('begin');
        await client.query('select id from search_run where id=$1 for update', [id]);
        if (material) {
          const charge = await client.query(
            `update search_run set materials=materials+1
            where id=$1 and status='running' and materials < (config->>'materialLimit')::int returning id`,
            [id],
          );
          if (!charge.rowCount) throw new BudgetStop('The run reached its material limit.');
        }
        await client.query('insert into run_step(run_id,key,material) values($1,$2,$3)', [
          id,
          key,
          material,
        ]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.off('error', onError);
        client.release();
      }
    }
    try {
      await action();
      await pool.query("update run_step set done=true,message='' where run_id=$1 and key=$2", [
        id,
        key,
      ]);
    } catch (err) {
      const message =
        budget.stopReason || (err instanceof Error ? err.message : 'The step failed.');
      await pool.query('update run_step set message=$3 where run_id=$1 and key=$2', [
        id,
        key,
        message.slice(0, 1000),
      ]);
      if (budget.stopReason || budget.controller.signal.aborted) throw new BudgetStop(message);
      throw err;
    }
  };
  try {
    for (const { source, entry } of sourcesToRequest(run.sources, catalog)) {
      if (run.config.discoveryLimit === 0) break;
      await step(`source/${source.id}`, false, async () => {
        // A removed or disabled source is never requested, even if the run snapshot enabled it.
        const current = await pool.query(
          'select 1 from source where id=$1 and enabled and catalog_id=$2 and param=$3',
          [source.id, source.catalogId, source.param],
        );
        if (!current.rowCount) return;
        const adapter = allAdapters[entry.id];
        if (!adapter) return;
        if (entry.rateLimit) await limiter.wait(entry.id, entry.rateLimit);
        const postings = await adapter.listJobs(source.param, budget.fetch);
        await savePostings(pool, source, entry.id, postings);
        // Admit jobs to this run after storing the complete board (truncation must not close jobs).
        const jobs = (
          await pool.query<{ id: string; title: string; location: string }>(
            `select distinct j.job_id as id,j.title,j.location
          from job_posting j where source_id=$1 and closed_at is null order by j.job_id`,
            [source.id],
          )
        ).rows;
        const checks = await checkJobs(pool, jobs, run.criteria);
        for (const job of jobs) {
          if (checks.get(job.id)?.verdict === 'ineligible') continue;
          await pool.query(
            `insert into run_job(run_id,job_id,title)
            select $1,$2,$3 where (select count(*) from run_job where run_id=$1) < $4
              and not exists(select 1 from application where job_id=$2 and status in('submitted','to_verify'))
            on conflict do nothing`,
            [id, job.id, job.title, run.config.discoveryLimit],
          );
        }
      });
      const count = await pool.query<{ n: number }>(
        'select count(*)::int as n from run_job where run_id=$1',
        [id],
      );
      if (count.rows[0]!.n >= run.config.discoveryLimit) break;
    }
    if (run.config.materialLimit > 0) {
      if (!deepseekApiKey) throw new Error('Set DEEPSEEK_API_KEY before preparing materials.');
      const jobs = (
        await pool.query<{ job_id: string; snapshot_id: string | null }>(
          'select job_id,snapshot_id from run_job where run_id=$1 order by job_id',
          [id],
        )
      ).rows;
      for (const job of jobs) {
        const jobId = job.job_id;
        await step(`${jobId}/1-text`, false, async () => {
          const detail = await loadJobDetail(pool, jobId);
          if (!detail) throw new Error('The job is no longer available.');
          if (!detail.snapshot) {
            const postings = (await postingsOf(pool, jobId)).filter((p) =>
              run.sources.some(
                (s) =>
                  s.enabled &&
                  s.id === p.source_id &&
                  s.catalogId === p.catalog_id &&
                  s.param === p.param,
              ),
            );
            const { catalogId, job: text } = await readFromSource(postings, {
              fetch: budget.fetch,
              limiter,
              log,
            });
            await saveSnapshot(pool, jobId, catalogId, text);
          }
          const snapshot = (await loadJobDetail(pool, jobId))!.snapshot!;
          await pool.query(
            'update run_job set snapshot_id=$3 where run_id=$1 and job_id=$2 and snapshot_id is null',
            [id, jobId, snapshot.id],
          );
        });
        const snapshotId = (
          await pool.query<{ snapshot_id: string }>(
            'select snapshot_id from run_job where run_id=$1 and job_id=$2',
            [id, jobId],
          )
        ).rows[0]!.snapshot_id;
        const modelOptions = { pool, fetch: budget.fetch, apiKey: deepseekApiKey, log, snapshotId };
        await step(`${jobId}/2-summary`, false, async () => {
          const exists = await pool.query('select 1 from job_summary where job_snapshot_id=$1', [
            snapshotId,
          ]);
          if (!exists.rowCount) await summariseSnapshot(modelOptions);
        });
        await step(`${jobId}/3-match`, false, async () => {
          const exists = await pool.query('select 1 from match where job_snapshot_id=$1', [
            snapshotId,
          ]);
          if (!exists.rowCount) await matchSnapshot(modelOptions);
        });
        const detail = await loadJobDetail(pool, jobId);
        const checks = await checkJobs(
          pool,
          [{ id: jobId, title: detail!.title, location: detail!.location }],
          run.criteria,
        );
        if (checks.get(jobId)?.verdict === 'ineligible') continue;
        for (const kind of ['resume', 'cover_letter'] as const) {
          const exists = await pool.query(
            'select 1 from artifact where job_snapshot_id=$1 and kind=$2',
            [snapshotId, kind],
          );
          if (exists.rowCount) {
            await pool.query(
              "update run_step set done=true,message='' where run_id=$1 and key=$2",
              [id, `${jobId}/4-${kind}`],
            );
            continue;
          }
          await step(`${jobId}/4-${kind}`, true, async () => {
            // A crash after saving a draft and before checkpointing must not create it twice.
            const saved = await pool.query(
              'select 1 from artifact where job_snapshot_id=$1 and kind=$2',
              [snapshotId, kind],
            );
            if (!saved.rowCount) await writeDraft({ ...modelOptions, kind, language: 'en' });
          });
        }
      }
    }
    await endRun(
      pool,
      id,
      'ready',
      'Preparation finished. Review each job and approve each submission yourself.',
    );
  } catch (err) {
    const stopped = err instanceof BudgetStop;
    if (!stopped && !(err instanceof DiscoveryError))
      log.warn({ err, runId: id }, 'run preparation failed');
    await endRun(
      pool,
      id,
      stopped ? 'paused' : 'failed',
      err instanceof Error ? err.message : 'Preparation failed.',
    );
  }
}
