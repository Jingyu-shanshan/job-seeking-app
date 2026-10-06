import Type, { type Static } from 'typebox';
import { AlertListingSchema } from './alerts.ts';
import { CriterionResultSchema, JobVerdictSchema, OutcomeSchema } from './criteria.ts';
import { DraftSummarySchema } from './drafts.ts';
import { CitedFactSchema } from './facts.ts';
import { JobSourceSchema } from './jobs.ts';

export const maxJobTextLength = 100_000;

export const QuotedSchema = Type.Object({
  text: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
});

export type Quoted = Static<typeof QuotedSchema>;

export const RequirementKindSchema = Type.Union([Type.Literal('must'), Type.Literal('nice')]);

export type RequirementKind = Static<typeof RequirementKindSchema>;

/** What the latest match found for one requirement. */
export const EvidenceSchema = Type.Object({
  /** As matched; `current` on the cited facts says whether it still counts. */
  outcome: OutcomeSchema,
  /** DeepSeek's explanation, untrusted text. */
  note: Type.String(),
  facts: Type.Array(CitedFactSchema),
});

export type Evidence = Static<typeof EvidenceSchema>;

export const RequirementSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  text: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
  kind: RequirementKindSchema,
  origin: Type.Union([Type.Literal('model'), Type.Literal('user')]),
  /** From the latest match; null when the requirement was not part of it. */
  evidence: Type.Union([EvidenceSchema, Type.Null()]),
});

export type Requirement = Static<typeof RequirementSchema>;

export const SummaryFieldValueSchema = Type.Object({
  value: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
});

export type SummaryFieldValue = Static<typeof SummaryFieldValueSchema>;

const summaryField = Type.Union([SummaryFieldValueSchema, Type.Null()]);

export const SummaryFieldsSchema = Type.Object({
  location: summaryField,
  workplace: summaryField,
  employmentType: summaryField,
  languages: summaryField,
  seniority: summaryField,
  salary: summaryField,
  visaSponsorship: summaryField,
});

export type SummaryFields = Static<typeof SummaryFieldsSchema>;
export type SummaryFieldKey = keyof SummaryFields;

export const JobSummarySchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  model: Type.String(),
  costUsd: Type.Number({ minimum: 0 }),
  responsibilities: Type.Array(QuotedSchema),
  fields: SummaryFieldsSchema,
});

export type JobSummary = Static<typeof JobSummarySchema>;

/** The latest evidence match of a snapshot. */
export const MatchSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  model: Type.String(),
  costUsd: Type.Number({ minimum: 0 }),
  /** How many facts were sent with the request. */
  factsSent: Type.Integer({ minimum: 0 }),
  /**
   * Why the match is out of date: the facts that may be sent, or the requirements, changed since.
   * Empty when it is up to date, in which case matching again is refused.
   */
  outdated: Type.Array(Type.String()),
});

export type Match = Static<typeof MatchSchema>;

export const SnapshotSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  capturedAt: Type.String({ format: 'date-time' }),
  catalogId: Type.String(),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  url: Type.String(),
  text: Type.String(),
  summary: Type.Union([JobSummarySchema, Type.Null()]),
  requirements: Type.Array(RequirementSchema),
  match: Type.Union([MatchSchema, Type.Null()]),
  /** The latest resume and cover letter drafts of this text, those that exist (T07). */
  drafts: Type.Array(DraftSummarySchema),
});

export type Snapshot = Static<typeof SnapshotSchema>;

export const JobDetailSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  /** Null when the app has no address for the job (see `Job.url`). */
  url: Type.Union([Type.String(), Type.Null()]),
  sources: Type.Array(JobSourceSchema),
  canImport: Type.Boolean(),
  /** Whether the user saved the job from a page in the desktop app. */
  saved: Type.Boolean(),
  /** The job-alert emails of sources in use that listed the job (T20). */
  alerts: Type.Array(AlertListingSchema),
  snapshot: Type.Union([SnapshotSchema, Type.Null()]),
  earlierSnapshots: Type.Integer({ minimum: 0 }),
  verdict: JobVerdictSchema,
  /** The user's criteria that are not off, checked against this job. */
  criteria: Type.Array(CriterionResultSchema),
  /** How many facts a match would send: confirmed ones the user allows to go to DeepSeek. */
  factsToSend: Type.Integer({ minimum: 0 }),
  /**
   * How many facts a draft would send: confirmed ones the user allows both to go to DeepSeek and
   * to appear in documents.
   */
  factsToDraft: Type.Integer({ minimum: 0 }),
});

export type JobDetail = Static<typeof JobDetailSchema>;

export const PasteJobRequestSchema = Type.Object({
  title: Type.String({ pattern: '\\S', maxLength: 1000 }),
  company: Type.Optional(Type.String({ maxLength: 1000 })),
  location: Type.Optional(Type.String({ maxLength: 5000 })),
  url: Type.String({ pattern: '^https://\\S+$', maxLength: 2000 }),
  text: Type.String({ pattern: '\\S', maxLength: maxJobTextLength }),
});

export type PasteJobRequest = Static<typeof PasteJobRequestSchema>;

/** Body of `POST /api/jobs/:id/text`: job text the user pasted for a job the app already has. */
export const PasteTextRequestSchema = Type.Object({
  text: Type.String({ pattern: '\\S', maxLength: maxJobTextLength }),
  /**
   * The link to the job's page, where the text was copied from. Needed when the app has no
   * address for the job; otherwise its address is used.
   */
  url: Type.Optional(Type.String({ pattern: '^https://\\S+$', maxLength: 2000 })),
});

export type PasteTextRequest = Static<typeof PasteTextRequestSchema>;

export const AddRequirementRequestSchema = Type.Object({
  text: Type.String({ pattern: '\\S', maxLength: 1000 }),
  quote: Type.String({ maxLength: 1000 }),
  kind: RequirementKindSchema,
  replaces: Type.Optional(Type.String({ format: 'uuid' })),
});

export type AddRequirementRequest = Static<typeof AddRequirementRequestSchema>;

export const ModelUsageSchema = Type.Object({
  calls: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  costUsd: Type.Number({ minimum: 0 }),
  inputTokens: Type.Integer({ minimum: 0 }),
  outputTokens: Type.Integer({ minimum: 0 }),
});

export type ModelUsage = Static<typeof ModelUsageSchema>;
