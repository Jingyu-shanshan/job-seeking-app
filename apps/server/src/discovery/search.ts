import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { JobSearchRequestSchema, type JobSearchResponse } from '@jsa/shared';
import { httpError } from '../http-error.ts';
import { jobSearchCandidates, jobSearchQuery } from '../rules/job-search.ts';
import { toolPriceUsd } from '../tools/provider.ts';
import { runTool, type ToolOptions } from '../tools/routes.ts';

export const jobSearchRoutes: FastifyPluginAsyncTypebox<ToolOptions> = async (app, options) => {
  app.get('/job-searches', async () => ({
    available: !!options.deepseekApiKey,
    estimatedCostUsd: toolPriceUsd,
  }));
  app.post(
    '/job-searches',
    { schema: { body: JobSearchRequestSchema } },
    async ({ body }): Promise<JobSearchResponse> => {
      let query: string;
      try {
        query = jobSearchQuery(body);
      } catch (error) {
        throw httpError(400, (error as Error).message);
      }
      const call = await runTool(options, {
        id: body.id,
        tool: 'search',
        input: query,
        maxCostUsd: body.maxCostUsd,
      });
      return {
        id: call.id,
        query,
        createdAt: call.createdAt,
        costUsd: call.costUsd,
        estimated: call.estimated,
        message: call.message,
        ...jobSearchCandidates(call.result, body.sources),
      };
    },
  );
};
