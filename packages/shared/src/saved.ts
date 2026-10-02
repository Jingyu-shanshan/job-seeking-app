import Type, { type Static } from 'typebox';
import { PasteJobRequestSchema } from './jd.ts';

// Saving from the desktop app (T21): the user browses a job site in the app's built-in browser
// and saves the page they are looking at. Everything in these requests was read from a
// third-party page, so it is untrusted text.

/**
 * Body of `POST /api/saved-pages`: one job page as the user saw it, with the same fields as a
 * pasted job. The text is the job's description, the text the user selected, or the page's
 * visible text.
 */
export const SavePageRequestSchema = PasteJobRequestSchema;

export type SavePageRequest = Static<typeof SavePageRequestSchema>;

export const SavePageResponseSchema = Type.Object({
  jobId: Type.String({ format: 'uuid' }),
  title: Type.String(),
  /** False when the app already had the job, from an earlier save or a job board. */
  newJob: Type.Boolean(),
  /**
   * `first` when the job had no text before, `new` when the text differs from every text it had,
   * `same` when this exact text was saved for it before.
   */
  text: Type.Union([Type.Literal('first'), Type.Literal('new'), Type.Literal('same')]),
});

export type SavePageResponse = Static<typeof SavePageResponseSchema>;

/** One job entry a results page showed: the list information only, no job text. */
export const SavedEntrySchema = Type.Object({
  url: Type.String({ pattern: '^https://\\S+$', maxLength: 2000 }),
  title: Type.String({ pattern: '\\S', maxLength: 1000 }),
  company: Type.Optional(Type.String({ maxLength: 1000 })),
  location: Type.Optional(Type.String({ maxLength: 5000 })),
});

export type SavedEntry = Static<typeof SavedEntrySchema>;

/** Body of `POST /api/saved-results`: the job entries a results page showed when the user saved. */
export const SaveResultsRequestSchema = Type.Object({
  entries: Type.Array(SavedEntrySchema, { minItems: 1, maxItems: 100 }),
});

export type SaveResultsRequest = Static<typeof SaveResultsRequestSchema>;

export const SaveResultsResponseSchema = Type.Object({
  /** Distinct jobs among the entries. */
  saved: Type.Integer({ minimum: 0 }),
  /** Those the app did not have before. */
  newJobs: Type.Integer({ minimum: 0 }),
});

export type SaveResultsResponse = Static<typeof SaveResultsResponseSchema>;
