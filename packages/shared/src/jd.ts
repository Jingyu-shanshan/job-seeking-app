import Type, { type Static } from 'typebox';
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

export const RequirementSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  text: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
  kind: RequirementKindSchema,
  origin: Type.Union([Type.Literal('model'), Type.Literal('user')]),
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
});

export type Snapshot = Static<typeof SnapshotSchema>;

export const JobDetailSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  url: Type.String(),
  sources: Type.Array(JobSourceSchema),
  canImport: Type.Boolean(),
  /** Whether the user saved the job from a page in the desktop app. */
  saved: Type.Boolean(),
  snapshot: Type.Union([SnapshotSchema, Type.Null()]),
  earlierSnapshots: Type.Integer({ minimum: 0 }),
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
