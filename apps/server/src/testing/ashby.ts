// A stand-in for Ashby's job posting API in tests. Boards and jobs are made up.

export interface FakeAshbyJob {
  id: string;
  title?: string;
  location?: string | null;
  country?: string | null;
  secondaryLocations?: { location: string; country?: string }[];
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  jobUrl?: string;
  publishedAt?: string;
}

const address = (country: string | null | undefined) => ({
  postalAddress: { addressLocality: '', addressRegion: '', addressCountry: country ?? '' },
});

/** A job as Ashby lists it, with made-up defaults for the fields not given. */
export function ashbyJob({
  id,
  location = 'Helsinki',
  country = 'Finland',
  secondaryLocations = [],
  ...rest
}: FakeAshbyJob) {
  return {
    id,
    title: `Job ${id}`,
    department: 'Engineering',
    team: 'Platform',
    employmentType: 'FullTime',
    location,
    address: address(country),
    secondaryLocations: secondaryLocations.map((other) => ({
      location: other.location,
      address: address(other.country),
    })),
    isListed: true,
    isRemote: false,
    workplaceType: 'OnSite',
    jobUrl: `https://jobs.ashbyhq.com/acme/${id}`,
    applyUrl: `https://jobs.ashbyhq.com/acme/${id}/application`,
    publishedAt: '2026-09-01T10:00:00.000+00:00',
    descriptionHtml: '<p>Made up.</p>',
    descriptionPlain: 'Made up.',
    ...rest,
  };
}

/**
 * A fetch that answers board requests from `boards` (by lowercase board name, as Ashby does):
 * jobs, an HTTP status, or a function for anything else. Unknown boards answer 404 in plain text,
 * as Ashby does. `requested` collects every URL asked for.
 */
export function fakeAshby(
  boards: Record<string, FakeAshbyJob[] | number | (() => Promise<Response>)>,
) {
  const requested: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const board = /^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/([^/?]+)$/.exec(url)?.[1];
    const answer = board === undefined ? 404 : (boards[board.toLowerCase()] ?? 404);
    if (typeof answer === 'function') return answer();
    if (typeof answer === 'number') return new Response('Not Found', { status: answer });
    return Response.json({ apiVersion: '1', jobs: answer.map(ashbyJob) });
  };
  return { fetch: fetch as typeof globalThis.fetch, requested };
}
