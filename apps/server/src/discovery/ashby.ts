import Type from 'typebox';
import { Value } from 'typebox/value';
import {
  DiscoveryError,
  fetchJson,
  fitLocation,
  httpsUrl,
  maybe,
  type Adapter,
} from './adapter.ts';

// Ashby's public job posting API (https://developers.ashbyhq.com/docs/public-job-posting-api,
// checked 2026-10-01 and 2026-10-02): one request lists every job of a board. No key, no login.
// Board names are not case-sensitive; an unknown board answers 404. The answer always includes
// the job text, which is not kept here: it goes into a JD snapshot in T05. It names no company.

const AddressSchema = maybe(
  Type.Object({
    postalAddress: maybe(Type.Object({ addressCountry: maybe(Type.String({ maxLength: 200 })) })),
  }),
);

const BoardSchema = Type.Object({
  jobs: Type.Array(
    Type.Object({
      id: Type.String({ pattern: '\\S', maxLength: 200 }),
      title: Type.String({ pattern: '\\S', maxLength: 1000 }),
      location: maybe(Type.String({ maxLength: 1000 })),
      address: AddressSchema,
      secondaryLocations: maybe(
        Type.Array(
          Type.Object({
            location: maybe(Type.String({ maxLength: 1000 })),
            address: AddressSchema,
          }),
          { maxItems: 100 },
        ),
      ),
      isListed: maybe(Type.Boolean()),
      isRemote: maybe(Type.Boolean()),
      workplaceType: maybe(Type.String()),
      jobUrl: maybe(Type.String()),
      publishedAt: maybe(Type.String({ format: 'date-time' })),
    }),
    { maxItems: 10_000 },
  ),
});

/** "Turku" in Finland as "Turku, Finland", so the location rule need not know Finnish towns. */
function place(location: string | null | undefined, country: string | null | undefined) {
  const text = location?.trim() ?? '';
  const name = country?.trim() ?? '';
  if (name === '' || text.toLowerCase().includes(name.toLowerCase())) return text;
  return text === '' ? name : `${text}, ${name}`;
}

export const ashbyBoard: Adapter = async (board, fetch) => {
  const name = encodeURIComponent(board);
  let body: unknown;
  try {
    body = await fetchJson(fetch, `https://api.ashbyhq.com/posting-api/job-board/${name}`);
  } catch (err) {
    if (err instanceof DiscoveryError && err.status === 404) {
      throw new DiscoveryError(`Ashby has no job board called ${board}.`);
    }
    throw err;
  }
  if (!Value.Check(BoardSchema, body)) {
    throw new DiscoveryError('Ashby answered with something other than a list of jobs.');
  }
  return (
    body.jobs
      // An unlisted job is meant to be reached only through its direct link.
      .filter((job) => job.isListed !== false)
      .map((job) => {
        // `workplaceType` is the newer field; `isRemote` is all that older jobs have.
        const remote = job.workplaceType ? job.workplaceType === 'Remote' : job.isRemote === true;
        const places = [
          place(job.location, job.address?.postalAddress?.addressCountry),
          ...(job.secondaryLocations ?? []).map((other) =>
            place(other.location, other.address?.postalAddress?.addressCountry),
          ),
        ].filter((text) => text !== '');
        // The location rule reads "remote" in the text; Ashby says it in a separate field.
        const marked = remote
          ? places.map((text) => (/remote/i.test(text) ? text : `Remote - ${text}`))
          : places;
        const location = marked.join('; ') || (remote ? 'Remote' : '');
        return {
          externalId: job.id,
          title: job.title.trim(),
          company: null,
          location: fitLocation(location),
          url:
            httpsUrl(job.jobUrl) ??
            `https://jobs.ashbyhq.com/${name}/${encodeURIComponent(job.id)}`,
          publishedAt: job.publishedAt ?? null,
        };
      })
  );
};
