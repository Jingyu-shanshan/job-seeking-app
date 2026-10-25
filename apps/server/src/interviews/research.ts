import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  CompanyResearchRequestSchema,
  type CompanyResearch,
  type CompanyResearchRequest,
  type CompanyResearchSource,
  type CompanyResearchState,
} from '@jsa/shared';
import { DomUtils, parseDocument } from 'htmlparser2';
import Type from 'typebox';
import { htmlToText } from '../discovery/html.ts';
import { httpError } from '../http-error.ts';
import { pageUrl, readPublicHtml } from '../jd/company-page.ts';
import { checkToolInput, toolPriceUsd } from '../tools/provider.ts';
import { runTool, type ToolOptions } from '../tools/routes.ts';

const params = Type.Object({ id: Type.String({ format: 'uuid' }) });
const columns = `r.id,r.company,r.website,r.topic,r.query,r.created_at as "createdAt",
  r.status,r.message,r.sources,r.issues,
  coalesce(t.cost_usd,t.reserved_usd,0)::float8 as "costUsd",
  (t.id is not null and t.cost_usd is null) as estimated`;

export function researchQuery(body: Pick<CompanyResearchRequest, 'company' | 'website' | 'topic'>) {
  const company = body.company.trim();
  if (!company || /["\\\r\n@:/]/u.test(company))
    throw httpError(400, 'Enter only the company name, without quotes, links or contact details.');
  const website = pageUrl(body.website.trim());
  if (website.pathname !== '/' || website.search || new URL(body.website.trim()).hash)
    throw httpError(
      400,
      'Use the official website origin only, without a path, query or fragment.',
    );
  const query = `"${company}" site:${website.hostname} ${body.topic === 'products' ? 'products' : `news ${new Date().getUTCFullYear()}`}`;
  checkToolInput('search', query);
  return { company, website: website.origin, query };
}

export function researchText(html: string) {
  const doc = parseDocument(html);
  const title = DomUtils.findOne((node) => node.name === 'title', doc.children, true);
  const main = DomUtils.findOne(
    (node) => node.name === 'main' || node.name === 'article',
    doc.children,
    true,
  );
  const text = htmlToText(main ? DomUtils.getOuterHTML(main) : html);
  if (text.length < 80) throw new Error('No readable public page text.');
  // shortcut: static HTML excerpts only; add rendering or model synthesis after separate cost review.
  return {
    title: title ? DomUtils.textContent(title).trim().slice(0, 1000) : '',
    text: text.slice(0, 20000),
    truncated: text.length > 20000,
  };
}

export const companyResearchRoutes: FastifyPluginAsyncTypebox<ToolOptions> = async (
  app,
  options,
) => {
  const { pool } = options;
  async function checkApplication(id: string) {
    if (!(await pool.query('select 1 from application where id=$1', [id])).rowCount)
      throw httpError(404, 'There is no such application.');
  }
  async function version(id: string) {
    return (
      await pool.query<CompanyResearch>(
        `select ${columns} from company_research r left join tool_call t on t.id=r.id where r.id=$1`,
        [id],
      )
    ).rows[0]!;
  }
  app.get(
    '/applications/:id/company-research',
    { schema: { params } },
    async ({ params }): Promise<CompanyResearchState> => {
      await checkApplication(params.id);
      return {
        available: !!options.deepseekApiKey,
        estimatedCostUsd: toolPriceUsd,
        versions: (
          await pool.query<CompanyResearch>(
            `select ${columns} from company_research r left join tool_call t on t.id=r.id
         where r.application_id=$1 order by r.created_at desc,r.id`,
            [params.id],
          )
        ).rows,
      };
    },
  );
  app.post(
    '/applications/:id/company-research',
    {
      schema: { params, body: CompanyResearchRequestSchema },
    },
    async ({ params, body }, reply): Promise<CompanyResearch> => {
      await checkApplication(params.id);
      const input = researchQuery(body);
      const previous = await pool.query('select * from company_research where id=$1', [body.id]);
      const same = (row: Record<string, unknown>) =>
        row.application_id === params.id &&
        row.company === input.company &&
        row.website === input.website &&
        row.topic === body.topic;
      if (previous.rows[0]) {
        if (!same(previous.rows[0]))
          throw httpError(409, 'This research ID belongs to another operation.');
        return version(body.id);
      }
      if (!options.deepseekApiKey) throw httpError(503, 'Set DEEPSEEK_API_KEY before researching.');
      if (body.maxCostUsd < toolPriceUsd)
        throw httpError(409, 'Review and approve the estimated search fee first.');
      const claim = await pool.query(
        `insert into company_research(id,application_id,company,website,topic,query)
       values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
        [body.id, params.id, input.company, input.website, body.topic, input.query],
      );
      if (!claim.rowCount) {
        const row = (await pool.query('select * from company_research where id=$1', [body.id]))
          .rows[0]!;
        if (!same(row)) throw httpError(409, 'This research ID belongs to another operation.');
        return version(body.id);
      }
      const sources: CompanyResearchSource[] = [];
      const issues: string[] = [];
      let message: string;
      let status: CompanyResearch['status'] = 'failed';
      const deadline = AbortSignal.timeout(60_000);
      try {
        const call = await runTool(
          {
            ...options,
            fetch: (url, init) => {
              deadline.throwIfAborted();
              return options.fetch(url, {
                ...init,
                signal: AbortSignal.any([deadline, init?.signal ?? deadline]),
              });
            },
          },
          {
            id: body.id,
            tool: 'search',
            input: input.query,
            maxCostUsd: body.maxCostUsd,
          },
        );
        if (!call.result || !('results' in call.result)) {
          message = call.message;
        } else {
          const seen = new Set<string>();
          const host = new URL(input.website).hostname;
          let attempted = 0;
          for (const item of call.result.results) {
            let url: URL;
            try {
              url = pageUrl(item.url);
            } catch {
              continue;
            }
            if (url.hostname !== host || seen.has(url.href)) continue;
            seen.add(url.href);
            if (attempted >= 3 || deadline.aborted) break;
            attempted++;
            try {
              const page = await readPublicHtml(url.href, 0, host, deadline);
              sources.push({
                url: url.href,
                finalUrl: page.url,
                method: 'public_page',
                readAt: new Date().toISOString(),
                ...researchText(page.html),
              });
            } catch {
              issues.push(
                `Could not safely read ${url.href}. Its content is unknown; no search summary was substituted.`,
              );
            }
          }
          status = sources.length ? 'completed' : 'failed';
          message = sources.length
            ? 'Official-site excerpts saved. These are source text, not verified conclusions; publication dates and recency are unverified.'
            : 'No readable official-site evidence found. Products or recent developments remain unknown. Previous versions are unchanged.';
        }
      } catch {
        message =
          'Research could not finish. Check the saved fee before starting a new paid search. Previous versions are unchanged.';
      }
      await pool.query(
        `update company_research set status=$2,message=$3,sources=$4,issues=$5,finished_at=now()
       where id=$1 and finished_at is null`,
        [body.id, status, message, JSON.stringify(sources), JSON.stringify(issues)],
      );
      return reply.code(201).send(await version(body.id));
    },
  );
};
