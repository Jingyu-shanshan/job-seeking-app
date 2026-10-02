// A stand-in for Greenhouse's Job Board API in tests. Boards and jobs are made up.

export interface FakeJob {
  id: number;
  title?: string;
  location?: string;
  company_name?: string;
  absolute_url?: string;
  first_published?: string;
  content?: string;
}

/** A job as Greenhouse lists it, with made-up defaults for the fields not given. */
export function greenhouseJob({ id, location = 'Helsinki, Finland', ...rest }: FakeJob) {
  return {
    id,
    internal_job_id: id + 1000,
    title: `Job ${id}`,
    company_name: 'Acme',
    location: { name: location },
    absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    first_published: '2026-09-01T10:00:00-04:00',
    updated_at: '2026-09-30T10:00:00-04:00',
    requisition_id: null,
    metadata: null,
    ...rest,
  };
}

/**
 * A fetch that answers board list requests from `boards` (by lowercase board name, as Greenhouse
 * does): jobs, an HTTP status, or a function for anything else. Unknown boards answer 404.
 * `requested` collects every URL asked for.
 */
export function fakeGreenhouse(
  boards: Record<string, FakeJob[] | number | (() => Promise<Response>)>,
) {
  const requested: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const [, board, jobId] =
      /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs(?:\/(\d+))?$/.exec(url) ??
      [];
    const answer = board === undefined ? 404 : (boards[board.toLowerCase()] ?? 404);
    if (typeof answer === 'function') return answer();
    const notFound = (status: number) =>
      Response.json({ status, error: 'Job not found' }, { status });
    if (typeof answer === 'number') return notFound(answer);
    if (jobId !== undefined) {
      const job = answer.find((j) => String(j.id) === jobId);
      if (!job) return notFound(404);
      const content = job.content ?? '&lt;p&gt;Made up job text.&lt;/p&gt;';
      return Response.json({ ...greenhouseJob(job), content, departments: [], offices: [] });
    }
    const jobs = answer.map(greenhouseJob);
    return Response.json({ jobs, meta: { total: jobs.length } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requested };
}
