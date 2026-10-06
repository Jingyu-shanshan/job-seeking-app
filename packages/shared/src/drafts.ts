import Type, { type Static } from 'typebox';
import { CitedFactSchema } from './facts.ts';

export const DraftKindSchema = Type.Union([Type.Literal('resume'), Type.Literal('cover_letter')]);

export type DraftKind = Static<typeof DraftKindSchema>;

/**
 * Where a statement goes. A resume has a headline, a summary and sections of entries; a cover
 * letter has paragraphs (`letter`).
 */
export const DraftSectionSchema = Type.Union([
  Type.Literal('headline'),
  Type.Literal('summary'),
  Type.Literal('experience'),
  Type.Literal('projects'),
  Type.Literal('skills'),
  Type.Literal('education'),
  Type.Literal('languages'),
  Type.Literal('certifications'),
  Type.Literal('letter'),
]);

export type DraftSection = Static<typeof DraftSectionSchema>;

/** An entry's title line, a bullet under it, or a sentence of a headline, summary or letter. */
export const DraftLineSchema = Type.Union([
  Type.Literal('title'),
  Type.Literal('bullet'),
  Type.Literal('sentence'),
]);

export type DraftLine = Static<typeof DraftLineSchema>;

/**
 * What a statement is about: the job seeker (it cites facts), the job (it quotes the job text), or
 * neither (a connecting sentence of a cover letter, which may carry no facts). Every resume
 * statement is about the job seeker.
 */
export const DraftAboutSchema = Type.Union([
  Type.Literal('me'),
  Type.Literal('job'),
  Type.Literal('other'),
]);

export type DraftAbout = Static<typeof DraftAboutSchema>;

export const ProblemCodeSchema = Type.Union([
  Type.Literal('uncited'),
  Type.Literal('unsent_fact'),
  Type.Literal('fact_changed'),
  Type.Literal('quote_not_found'),
  Type.Literal('number'),
  Type.Literal('qualifier'),
  Type.Literal('date'),
  Type.Literal('term'),
  Type.Literal('status'),
  Type.Literal('sensitive'),
  Type.Literal('placeholder'),
]);

export type ProblemCode = Static<typeof ProblemCodeSchema>;

/** Why a statement may not go into the document. */
export const ProblemSchema = Type.Object({
  code: ProblemCodeSchema,
  message: Type.String(),
});

export type Problem = Static<typeof ProblemSchema>;

export const DraftStatementSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  section: DraftSectionSchema,
  /** The entry (resume) or paragraph (cover letter) within the section, from 0. */
  block: Type.Integer({ minimum: 0 }),
  line: DraftLineSchema,
  about: DraftAboutSchema,
  /** Written by DeepSeek: untrusted text, shown as is. */
  text: Type.String(),
  /** The job-text passage a statement about the job rests on, as DeepSeek gave it. */
  quote: Type.Union([Type.String(), Type.Null()]),
  /** The facts it cites; `current` is false once a fact changed or may no longer be used. */
  facts: Type.Array(CitedFactSchema),
  /** Empty when the statement passed every check and is in the document. */
  problems: Type.Array(ProblemSchema),
  /** The text is a cited fact word for word, so DeepSeek wrote nothing of its own. */
  verbatim: Type.Boolean(),
});

export type DraftStatement = Static<typeof DraftStatementSchema>;

export const DraftSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: DraftKindSchema,
  jobId: Type.String({ format: 'uuid' }),
  snapshotId: Type.String({ format: 'uuid' }),
  /** The job as its text was captured. */
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  model: Type.String(),
  costUsd: Type.Number({ minimum: 0 }),
  factsSent: Type.Integer({ minimum: 0 }),
  /**
   * Why the draft is out of date: the facts that may be used changed since, or the job has a newer
   * text. Empty when writing again would send the same request, which is then refused.
   */
  outdated: Type.Array(Type.String()),
  statements: Type.Array(DraftStatementSchema),
});

export type Draft = Static<typeof DraftSchema>;

/** The latest draft of one kind for a job text, as the job page lists it. */
export const DraftSummarySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: DraftKindSchema,
  createdAt: Type.String({ format: 'date-time' }),
  statements: Type.Integer({ minimum: 0 }),
  /** Statements that failed a check and are left out of the document. */
  rejected: Type.Integer({ minimum: 0 }),
  outdated: Type.Array(Type.String()),
});

export type DraftSummary = Static<typeof DraftSummarySchema>;

export const WriteDraftRequestSchema = Type.Object({ kind: DraftKindSchema });

export type WriteDraftRequest = Static<typeof WriteDraftRequestSchema>;
