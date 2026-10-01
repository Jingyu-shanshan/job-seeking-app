// A stand-in for Greenhouse's Job Board API in tests. Boards and jobs are made up.

export interface FakeJob {
  id: number;
  title?: string;
  location?: string;
  company_name?: string;
  absolute_url?: string;
  first_published?: string;
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
    const board = /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs$/.exec(
      url,
    )?.[1];
    const answer = board === undefined ? 404 : (boards[board.toLowerCase()] ?? 404);
    if (typeof answer === 'function') return answer();
    if (typeof answer === 'number') {
      return Response.json({ status: answer, error: 'Job not found' }, { status: answer });
    }
    const jobs = answer.map(greenhouseJob);
    return Response.json({ jobs, meta: { total: jobs.length } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requested };
}
