import type { JobSearchRequest, JobSearchResponse, ToolResult } from '@jsa/shared';
import { jobLink } from './job-link.ts';

export function jobSearchQuery(
  request: Pick<JobSearchRequest, 'role' | 'location' | 'sources'>,
): string {
  const terms = [request.role.trim(), request.location.trim()];
  if (terms.some((term) => !term || /["\\\r\n]/u.test(term))) {
    throw new Error('Enter a role and location without quotes, backslashes or line breaks.');
  }
  const domains: string[] = [];
  if (request.sources.includes('greenhouse_board'))
    domains.push('job-boards.greenhouse.io', 'boards.greenhouse.io');
  if (request.sources.includes('ashby_board')) domains.push('jobs.ashbyhq.com');
  if (!domains.length) throw new Error('Choose Greenhouse or Ashby to search.');
  const query = [
    ...terms.map((term) => `"${term}"`),
    domains.map((domain) => `site:${domain}`).join(' OR '),
  ].join(' ');
  if ([...query].length > 128)
    throw new Error(
      'Shorten the role or location: the complete search query must fit within 128 characters, including source filters.',
    );
  return query;
}

/** Search filters are hints to the provider; only recognised, selected board links survive. */
export function jobSearchCandidates(
  result: ToolResult | null,
  sources: JobSearchRequest['sources'],
): Pick<JobSearchResponse, 'candidates' | 'ignored'> {
  const candidates: JobSearchResponse['candidates'] = [];
  const ignored: JobSearchResponse['ignored'] = [];
  const seen = new Set<string>();
  if (!result || !('results' in result)) return { candidates, ignored };
  for (const item of result.results) {
    const link = jobLink(item.url);
    if (!link || !sources.includes(link.catalogId)) {
      ignored.push({
        title: item.title,
        reason: 'Not a single job link from your selected Greenhouse or Ashby sources.',
      });
      continue;
    }
    const url =
      link.catalogId === 'greenhouse_board'
        ? `https://job-boards.greenhouse.io/${link.board}/jobs/${link.id}`
        : `https://jobs.ashbyhq.com/${link.board}/${link.id}`;
    if (seen.has(url)) {
      ignored.push({ title: item.title, reason: 'Duplicate job link; shown once.' });
      continue;
    }
    seen.add(url);
    candidates.push({ url, title: item.title, snippet: item.snippet, source: link.catalogId });
  }
  return { candidates, ignored };
}
