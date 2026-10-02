import Type, { type Static } from 'typebox';
import { SearchScopeSchema } from './sources.ts';

/**
 * Whether a job's location is in the search scope. A missing or unrecognised location is
 * `to_confirm`, never `out_of_scope`.
 */
export const LocationVerdictSchema = Type.Union([
  Type.Literal('in_scope'),
  Type.Literal('to_confirm'),
  Type.Literal('out_of_scope'),
]);

export type LocationVerdict = Static<typeof LocationVerdictSchema>;

/** An open job that discovery found. A job listed by several sources appears once. */
export const JobSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  /** The company as the source names it; null when the source does not say. */
  company: Type.Union([Type.String(), Type.Null()]),
  /** As the source wrote it; '' when it gave none. Several locations are separated by ";". */
  location: Type.String(),
  /** The job's page at the source, always https. */
  url: Type.String(),
  /** When the source first published the job; null when it does not say. */
  publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** When a discovery run first found the job. */
  firstSeenAt: Type.String({ format: 'date-time' }),
  /** The user's sources that list the job, e.g. one Greenhouse board. */
  sources: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      catalogId: Type.String(),
      param: Type.String(),
    }),
  ),
  verdict: LocationVerdictSchema,
  /** Why the job is out of scope or to be confirmed; '' when it is in scope. */
  reason: Type.String(),
});

export type Job = Static<typeof JobSchema>;

/** Response of `GET /api/jobs`: the open jobs, classified by the scope that is returned too. */
export const JobsResponseSchema = Type.Object({
  scope: SearchScopeSchema,
  jobs: Type.Array(JobSchema),
});

export type JobsResponse = Static<typeof JobsResponseSchema>;

/** What one discovery run did with one source. */
export const SourceRunSchema = Type.Object({
  sourceId: Type.String({ format: 'uuid' }),
  catalogId: Type.String(),
  /** The catalog entry's name, e.g. "Greenhouse job boards". */
  name: Type.String(),
  param: Type.String(),
  outcome: Type.Union([Type.Literal('ok'), Type.Literal('failed'), Type.Literal('skipped')]),
  /** Why the source failed or was skipped; '' when it worked. */
  reason: Type.String(),
  /**
   * When it worked: the jobs it lists now, how many of them the app had not seen through any
   * source before, and how many it no longer lists.
   */
  found: Type.Integer({ minimum: 0 }),
  added: Type.Integer({ minimum: 0 }),
  closed: Type.Integer({ minimum: 0 }),
});

export type SourceRun = Static<typeof SourceRunSchema>;

/**
 * Response of `POST /api/discovery-runs`. The run requests only enabled sources the app may
 * request itself, at most `requestLimit` times; it never adds sources or widens the scope.
 */
export const DiscoveryRunSchema = Type.Object({
  requests: Type.Integer({ minimum: 0 }),
  requestLimit: Type.Integer({ minimum: 1 }),
  sources: Type.Array(SourceRunSchema),
});

export type DiscoveryRun = Static<typeof DiscoveryRunSchema>;
