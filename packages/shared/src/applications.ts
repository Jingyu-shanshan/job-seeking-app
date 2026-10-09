import Type, { type Static } from 'typebox';
import { OutcomeSchema } from './criteria.ts';
import { DraftKindSchema } from './drafts.ts';
import { FactKindSchema } from './facts.ts';
import { RequirementKindSchema } from './jd.ts';
import { maxManualFiles, maxPdfBytes } from './limits.ts';
import { ApplicationMethodSchema, ApplicationStatusSchema, SubmitReceiptSchema } from './runner.ts';

// The application record (T09). When an application is recorded it keeps what it was built from:
// the job text, the match of that text, the files that went out, the fact versions they cite, and
// for the runner the form's values the user approved and what the page showed after Submit. Later
// changes to facts, drafts or answers do not change it.

const date = Type.String({ format: 'date-time' });
const nullable = <T extends Type.TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** An application in the list. Title and company are the frozen job text's. */
export const ApplicationSummarySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  jobId: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: nullable(Type.String()),
  status: ApplicationStatusSchema,
  method: ApplicationMethodSchema,
  /** When the runner was let press Submit, or when the user recorded it. */
  createdAt: date,
  /** When it went in: the runner's press of Submit, or the time the user gave. */
  submittedAt: nullable(date),
});

export type ApplicationSummary = Static<typeof ApplicationSummarySchema>;

export const ApplicationsResponseSchema = Type.Object({
  applications: Type.Array(ApplicationSummarySchema),
});

export type ApplicationsResponse = Static<typeof ApplicationsResponseSchema>;

/** A file that went out with an application. */
export const ApplicationFileSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  /** The form's question it answered; '' for a file the user recorded. */
  label: Type.String(),
  fileName: Type.String(),
  bytes: Type.Integer({ minimum: 1 }),
  sha256: Type.String(),
  /** The draft it was printed from, when it is a PDF the app kept; null for an upload. */
  draft: nullable(Type.Object({ id: Type.String({ format: 'uuid' }), kind: DraftKindSchema })),
  url: Type.String(),
});

export type ApplicationFile = Static<typeof ApplicationFileSchema>;

/** A fact version the files cite, as it was then. */
export const FrozenFactSchema = Type.Object({
  factVersionId: Type.String({ format: 'uuid' }),
  factId: Type.String({ format: 'uuid' }),
  kind: FactKindSchema,
  version: Type.Integer({ minimum: 1 }),
  text: Type.String(),
  /** Whether it is still its fact's current, confirmed version. */
  stillCurrent: Type.Boolean(),
});

export type FrozenFact = Static<typeof FrozenFactSchema>;

/** The match of the frozen job text that was latest when the application was recorded. */
export const FrozenMatchSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  createdAt: date,
  verdict: Type.Union([
    Type.Literal('eligible'),
    Type.Literal('to_confirm'),
    Type.Literal('ineligible'),
  ]),
  requirements: Type.Array(
    Type.Object({
      kind: RequirementKindSchema,
      text: Type.String(),
      outcome: OutcomeSchema,
      note: Type.String(),
    }),
  ),
});

export type FrozenMatch = Static<typeof FrozenMatchSchema>;

/** An application as it was recorded. */
export const ApplicationRecordSchema = Type.Object({
  ...ApplicationSummarySchema.properties,
  /** The user's words about an application recorded by hand. */
  note: Type.String(),
  /** The job's text the application was made for. */
  job: Type.Object({
    snapshotId: Type.String({ format: 'uuid' }),
    title: Type.String(),
    company: nullable(Type.String()),
    location: Type.String(),
    url: Type.String(),
    capturedAt: date,
    text: Type.String(),
  }),
  match: nullable(FrozenMatchSchema),
  files: Type.Array(ApplicationFileSchema),
  facts: Type.Array(FrozenFactSchema),
  /** The runner's: the form's values as the user approved them. */
  form: nullable(
    Type.Object({
      approvedAt: date,
      fields: Type.Array(Type.Object({ label: Type.String(), value: Type.Array(Type.String()) })),
      screenshotUrl: Type.String(),
    }),
  ),
  receipt: nullable(SubmitReceiptSchema),
});

export type ApplicationRecord = Static<typeof ApplicationRecordSchema>;

/** A PDF the app kept of one of the job's drafts, which the user may say went out. */
export const KeptPdfSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: DraftKindSchema,
  fileName: Type.String(),
  createdAt: date,
  sha256: Type.String(),
});

export type KeptPdf = Static<typeof KeptPdfSchema>;

/** A job's applications, and recording one sent outside the app. */
export const JobApplicationsSchema = Type.Object({
  /** Newest first. */
  applications: Type.Array(ApplicationSummarySchema),
  /** Why one sent outside the app cannot be recorded now, or null. */
  cannotRecord: nullable(Type.String()),
  pdfs: Type.Array(KeptPdfSchema),
});

export type JobApplications = Static<typeof JobApplicationsSchema>;

/** An application the user sent outside the app. */
export const RecordApplicationRequestSchema = Type.Object({
  /** When they sent it; not in the future. */
  submittedAt: date,
  note: Type.String({ maxLength: 1000 }),
  /** Kept PDFs of the job's drafts that went out. */
  documentPdfIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20, uniqueItems: true }),
  /** The files that went out, as sent: PDFs in base64. */
  files: Type.Array(
    Type.Object({
      fileName: Type.String({ pattern: '\\S', maxLength: 200 }),
      body: Type.String({ minLength: 1, maxLength: Math.ceil(maxPdfBytes / 3) * 4 }),
    }),
    { maxItems: maxManualFiles },
  ),
});

export type RecordApplicationRequest = Static<typeof RecordApplicationRequestSchema>;
