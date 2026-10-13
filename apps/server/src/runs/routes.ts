import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  RunConfigSchema,
  RunPresetSchema,
  RunSchema,
  RunsResponseSchema,
  StartRunSchema,
} from '@jsa/shared';
import type { PoolClient } from 'pg';
import Type from 'typebox';
import { httpError } from '../http-error.ts';
import { RunBudget } from './budget.ts';
import { createRun, endRun, loadRun, presets } from './store.ts';
import { prepareRun, type WorkerOptions } from './worker.ts';
const params = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const runRoutes: FastifyPluginAsyncTypebox<Omit<WorkerOptions, 'log'>> = async (
  app,
  options,
) => {
  const { pool } = options;
  let closed = false;
  let working: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let wakeAfterWork = false;
  let active: { id: string; budget: RunBudget } | undefined;
  const tick = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = undefined;
    if (working) {
      wakeAfterWork = true;
      return;
    }
    working = work()
      .catch((err) => {
        app.log.error({ err }, 'run worker failed');
        schedule(60_000);
      })
      .finally(() => {
        working = undefined;
        if (wakeAfterWork) {
          wakeAfterWork = false;
          tick();
        }
      });
  };
  async function work() {
    const client = await pool.connect();
    const connectionLost = () => active?.budget.controller.abort();
    client.on('error', connectionLost);
    let locked = false;
    try {
      locked = (
        await client.query<{ locked: boolean }>('select pg_try_advisory_lock(141414) as locked')
      ).rows[0]!.locked;
      if (!locked) return;
      // Only a worker holding this lock can recover an interrupted run; another replica is alive otherwise.
      const interrupted = await client.query<{ id: string }>(
        "select id from search_run where status='running'",
      );
      for (const r of interrupted.rows)
        await endRun(
          pool,
          r.id,
          'paused',
          'The server stopped. Resume to continue with the same budget.',
        );
      const queued = await client.query<{ id: string }>(
        "select id from search_run where status='queued' order by created_at limit 1",
      );
      let id = queued.rows[0]?.id;
      if (!id) {
        const due = await client.query<{
          id: string;
        }>(`select p.id from run_preset p where p.next_at<=now()
          and not exists(select 1 from search_run r where r.preset_id=p.id and r.status in('paused','failed'))
          order by p.next_at limit 1`);
        if (due.rows[0]) id = await createRun(pool, due.rows[0].id);
      }
      if (!id || closed) return;
      const claimed = await client.query(
        "update search_run set status='running',active_since=now(),message='' where id=$1 and status='queued' returning id",
        [id],
      );
      if (!claimed.rowCount) return;
      const budget = new RunBudget({ pool, id, fetch: options.fetch });
      active = { id, budget };
      await prepareRun({ ...options, log: app.log }, id, budget);
    } finally {
      active = undefined;
      if (locked) await unlock(client);
      client.off('error', connectionLost);
      client.release();
      await arm(locked ? undefined : 1000);
    }
  }
  async function unlock(client: PoolClient) {
    await client.query('select pg_advisory_unlock(141414)').catch(() => {});
  }
  function schedule(delay: number) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
    timer.unref();
  }
  // shortcut: schedule edits wake the serving instance, add LISTEN/NOTIFY for persistent multi-replica failover.
  async function arm(retry?: number) {
    if (closed) return;
    if (retry !== undefined) {
      schedule(retry);
      return;
    }
    const { rows } = await pool.query<{ queued: boolean; next_at: Date | null }>(`select
      exists(select 1 from search_run where status='queued') as queued,
      (select min(p.next_at) from run_preset p where not exists
        (select 1 from search_run r where r.preset_id=p.id and r.status in('paused','failed'))) as next_at`);
    const next = rows[0]!;
    if (next.queued) schedule(1000);
    else if (next.next_at) schedule(Math.max(1000, next.next_at.getTime() - Date.now()));
  }
  app.addHook('onReady', async () => {
    tick();
  });
  app.addHook('onClose', async () => {
    closed = true;
    clearTimeout(timer);
    if (active) {
      active.budget.controller.abort();
      await endRun(pool, active.id, 'paused', 'The server stopped. Resume to continue.');
    }
    await working;
  });
  app.get('/runs', { schema: { response: { 200: RunsResponseSchema } } }, async () => {
    const ids = await pool.query<{ id: string }>(
      'select id from search_run order by created_at desc limit 50',
    );
    return {
      presets: await presets(pool),
      runs: await Promise.all(ids.rows.map((r) => loadRun(pool, r.id))),
    };
  });
  app.post(
    '/run-presets',
    { schema: { body: RunConfigSchema, response: { 201: RunPresetSchema } } },
    async (request, reply) => {
      const { rows } = await pool.query(
        `insert into run_preset(config,next_at) values($1,
      case when $2::int=0 then null else now()+make_interval(hours=>$2::int) end) returning id,config`,
        [JSON.stringify(request.body), request.body.intervalHours],
      );
      tick();
      return reply.code(201).send(rows[0]);
    },
  );
  app.put(
    '/run-presets/:id',
    { schema: { params, body: RunConfigSchema, response: { 200: RunPresetSchema } } },
    async (request) => {
      const { rows } = await pool.query(
        `update run_preset set config=$2,next_at=case when $3::int=0 then null
      else now()+make_interval(hours=>$3::int) end where id=$1 returning id,config`,
        [request.params.id, JSON.stringify(request.body), request.body.intervalHours],
      );
      if (!rows[0]) throw httpError(404, 'There is no such preset.');
      tick();
      return rows[0];
    },
  );
  app.post(
    '/runs',
    { schema: { body: StartRunSchema, response: { 202: RunSchema } } },
    async (request, reply) => {
      const id = await createRun(pool, request.body.presetId);
      const result = await loadRun(pool, id);
      tick();
      return reply.code(202).send(result);
    },
  );
  app.get('/runs/:id', { schema: { params, response: { 200: RunSchema } } }, (request) =>
    loadRun(pool, request.params.id),
  );
  app.post(
    '/runs/:id/stop',
    { schema: { params, response: { 200: RunSchema } } },
    async (request) => {
      const id = request.params.id;
      await loadRun(pool, id);
      await endRun(pool, id, 'paused', 'You stopped this run.');
      await pool.query(
        "update search_run set status='paused',message='You stopped this run.' where id=$1 and status in('queued','ready','failed')",
        [id],
      );
      if (active?.id === id) active.budget.controller.abort();
      // Withdrawal ensures resuming cannot resurrect an approval the user gave before stopping.
      await pool.query(
        `update submit_approval set withdrawn_at=now() where used_at is null and withdrawn_at is null
      and fill_task_id in(select id from fill_task where run_id=$1)`,
        [id],
      );
      await pool.query(
        `update fill_task set status='filled',message='The run stopped. Approve again after resuming.',updated_at=now()
        where run_id=$1 and status='approved'`,
        [id],
      );
      tick();
      return loadRun(pool, id);
    },
  );
  app.post(
    '/runs/:id/resume',
    { schema: { params, response: { 202: RunSchema } } },
    async (request, reply) => {
      const run = await loadRun(pool, request.params.id);
      if (run.status !== 'paused' && run.status !== 'failed')
        throw httpError(409, 'Only a stopped or failed run can resume.');
      try {
        await pool.query(
          "update search_run set status='queued',message='' where id=$1 and status in('paused','failed')",
          [run.id],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw httpError(409, 'Another run is queued or running.');
        throw err;
      }
      const result = await loadRun(pool, run.id);
      tick();
      return reply.code(202).send(result);
    },
  );
};
