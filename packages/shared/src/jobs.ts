import Type, { type Static } from 'typebox';
import { CriterionResultSchema, JobVerdictSchema } from './criteria.ts';
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

export const JobSourceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  catalogId: Type.String(),
  param: Type.String(),
});

export type JobSource = Static<typeof JobSourceSchema>;

/**
 * How a job came into the app: found by a discovery run, saved from a page in the desktop app
 * (T21), read from a job-alert email (T20), or pasted. A job that came in several ways appears
 * once, as the first of these.
 */
export const JobOriginSchema = Type.Union([
  Type.Literal('discovered'),
  Type.Literal('saved'),
  Type.Literal('alert'),
  Type.Literal('pasted'),
]);

export type JobOrigin = Static<typeof JobOriginSchema>;

/**
 * A job in the list: an open job that discovery found, a saved, pasted or alert-email job. A job
 * listed by several sources appears once.
 */
export const JobSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  /** The company as the source names it; null when the source does not say. */
  company: Type.Union([Type.String(), Type.Null()]),
  /** As the source wrote it; '' when it gave none. Several locations are separated by ";". */
  location: Type.String(),
  /**
   * The job's page at the source, always https; null when the app has no address for it: a
   * job-alert email that links to it only through a tracker the app cannot read.
   */
  url: Type.Union([Type.String(), Type.Null()]),
  /** When the source first published the job; null when it does not say. */
  publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** When the job first came into the app. */
  firstSeenAt: Type.String({ format: 'date-time' }),
  /** The user's sources that list the job, e.g. one Greenhouse board. */
  sources: Type.Array(JobSourceSchema),
  /** The names of the job-alert sources in use whose emails listed the job (T20). */
  alerts: Type.Array(Type.String()),
  origin: JobOriginSchema,
  /**
   * True when the app has only the job's entry on a results page or in an alert email, no job
   * text, and no source it can read the text from. Such a job is not summarised or matched until
   * its text is saved or pasted.
   */
  needsText: Type.Boolean(),
  verdict: JobVerdictSchema,
  /**
   * The job's application that went in (`submitted`) or whose result is unknown (`to_verify`);
   * null when there is none. Only `submitted` counts as applied.
   */
  application: Type.Union([Type.Literal('submitted'), Type.Literal('to_verify'), Type.Null()]),
  /** The user's criteria that are not off, checked against this job. */
  criteria: Type.Array(CriterionResultSchema),
});

export type Job = Static<typeof JobSchema>;

/** Response of `GET /api/jobs`: the jobs, checked against the user's criteria. */
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
