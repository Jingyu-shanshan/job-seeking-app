import type { Pool } from 'pg';
import { deepseek, estimateCost } from '../model/deepseek.ts';
import { reserveModelCost } from '../rules/run-budget.ts';

export class BudgetStop extends Error {}
export class RunBudget {
  readonly controller = new AbortController();
  stopReason = '';
  readonly fetch: typeof globalThis.fetch;
  constructor(privateOptions: { pool: Pool; id: string; fetch: typeof globalThis.fetch }) {
    const { pool, id, fetch } = privateOptions;
    this.fetch = async (input, init) => {
      const model = String(input instanceof Request ? input.url : input) === deepseek.url;
      const reserved = model ? reserveModelCost(String(init?.body)) : 0;
      if (this.controller.signal.aborted) throw new BudgetStop('The run was stopped.');
      const { rows } = await pool.query<{ id: string; remaining: number }>(
        `with charged as (
        update search_run set requests=requests+1,cost_usd=cost_usd+$2
        where id=$1 and status='running' and requests < (config->>'requestLimit')::int
          and cost_usd+$2 <= (config->>'costLimitUsd')::numeric
          and elapsed_ms + extract(epoch from(now()-active_since))*1000 < (config->>'timeLimitSeconds')::int*1000
        returning id,config,elapsed_ms,active_since
      ), sent as (
        insert into run_request (run_id,reserved_usd) select id,$2 from charged returning id
      ) select sent.id, greatest(1, floor((charged.config->>'timeLimitSeconds')::int*1000-charged.elapsed_ms-
        extract(epoch from(now()-charged.active_since))*1000))::int as remaining from sent,charged`,
        [id, reserved],
      );
      const attempt = rows[0];
      if (!attempt) {
        this.stopReason = 'The run stopped or reached its request, time or estimated cost limit.';
        throw new BudgetStop(this.stopReason);
      }
      const signal = AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(attempt.remaining),
        ...(init?.signal ? [init.signal] : []),
      ]);
      let response: Response;
      try {
        response = await fetch(input, { ...init, signal });
      } catch (err) {
        if (signal.aborted)
          this.stopReason = 'The request was stopped or timed out; its reserved cost is kept.';
        throw err;
      }
      if (model) {
        try {
          const parsed: unknown = await response.clone().json();
          const u = (
            parsed as {
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                prompt_cache_hit_tokens?: number;
              };
            }
          )?.usage;
          if (
            u &&
            Number.isSafeInteger(u.prompt_tokens) &&
            Number.isSafeInteger(u.completion_tokens) &&
            u.prompt_tokens! >= 0 &&
            u.completion_tokens! >= 0
          ) {
            const cost = estimateCost({
              inputTokens: u.prompt_tokens!,
              outputTokens: u.completion_tokens!,
              cachedInputTokens: Math.min(
                Math.max(u.prompt_cache_hit_tokens ?? 0, 0),
                u.prompt_tokens!,
              ),
            });
            await pool.query(
              `with settled as (
              update run_request set cost_usd=$2 where id=$1 and cost_usd is null returning run_id,reserved_usd
            ) update search_run set cost_usd=greatest(0,cost_usd+$2-settled.reserved_usd) from settled
              where search_run.id=settled.run_id`,
              [attempt.id, cost],
            );
          }
        } catch {
          /* Unknown provider usage keeps the full reservation. */
        }
      }
      return response;
    };
  }
}
