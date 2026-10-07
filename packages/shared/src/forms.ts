import Type, { type Static } from 'typebox';

// Application forms and the user's answers to them (T16). Only the user writes answers: the app
// fills a question from the user's answer for that job, a saved answer whose wording is the
// question's, the user's details or a kept PDF, and asks the user about every other question.

/**
 * How a question is answered: a line of text, a longer text, a file, one option, several
 * options, or a consent the user gives for this one application.
 */
export const FormQuestionKindSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('textarea'),
  Type.Literal('file'),
  Type.Literal('single'),
  Type.Literal('multi'),
  Type.Literal('consent'),
]);

export type FormQuestionKind = Static<typeof FormQuestionKindSchema>;

/**
 * Which part of the form asks it: the form's own questions, where the applicant lives,
 * government-contractor self-identification (`compliance`, such as EEOC), voluntary demographic
 * questions, or data-protection consent.
 */
export const FormQuestionGroupSchema = Type.Union([
  Type.Literal('questions'),
  Type.Literal('location'),
  Type.Literal('compliance'),
  Type.Literal('demographic'),
  Type.Literal('consent'),
]);

export type FormQuestionGroup = Static<typeof FormQuestionGroupSchema>;

/** One question of a job's application form, as the app read it from the form's source. */
export const FormQuestionSchema = Type.Object({
  /** The form's own name for the field, unique within the form, such as `email`. */
  key: Type.String({ minLength: 1, maxLength: 200 }),
  label: Type.String({ minLength: 1, maxLength: 2000 }),
  /** Plain text the form shows with the question; '' when none. */
  description: Type.String({ maxLength: 10_000 }),
  required: Type.Boolean(),
  kind: FormQuestionKindSchema,
  /** The options of a `single` or `multi` question, as the form words them. */
  options: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 1000 }),
  group: FormQuestionGroupSchema,
});

export type FormQuestion = Static<typeof FormQuestionSchema>;

/**
 * What the app does with a question: fills it, needs the user's answer (a required question with
 * no answer that fits), leaves an optional question empty, or holds back a sensitive saved answer
 * from an optional question until the user chooses to answer it for this job.
 */
export const FillStatusSchema = Type.Union([
  Type.Literal('filled'),
  Type.Literal('needs_answer'),
  Type.Literal('optional_empty'),
  Type.Literal('held_back'),
]);

export type FillStatus = Static<typeof FillStatusSchema>;

/** Where a filled answer comes from. */
export const FillSourceSchema = Type.Union([
  /** The user's answer for this job. */
  Type.Literal('job'),
  Type.Literal('saved'),
  /** Your details (T08). */
  Type.Literal('profile'),
  /** A PDF kept on a draft's document page (T08). */
  Type.Literal('document'),
]);

export type FillSource = Static<typeof FillSourceSchema>;

export const FormFillSchema = Type.Object({
  question: FormQuestionSchema,
  status: FillStatusSchema,
  /** What goes into the form: the text, the chosen options, or the PDF's file name. */
  answer: Type.Array(Type.String()),
  /** Null unless `filled`. */
  source: Type.Union([FillSourceSchema, Type.Null()]),
  /** The saved answer that fills the question, is held back, or does not fit it. */
  savedAnswerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  /** The kept PDF that fills a file question. */
  documentPdfId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  /** Whether the answer is sensitive: a sensitive saved answer, or a self-identification question. */
  sensitive: Type.Boolean(),
  /** Where the answer comes from, or why there is none. */
  note: Type.String(),
  /** Whether the user gave an answer for this job, which they can take back. */
  answeredForJob: Type.Boolean(),
  /** The default of “Sensitive” when the user saves an answer to this question for later. */
  looksSensitive: Type.Boolean(),
});

export type FormFill = Static<typeof FormFillSchema>;

export const JobFormSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  catalogId: Type.String(),
  readAt: Type.String({ format: 'date-time' }),
  /** The last time the app read this same form. */
  lastReadAt: Type.String({ format: 'date-time' }),
  fills: Type.Array(FormFillSchema),
});

export type JobForm = Static<typeof JobFormSchema>;

/** A job's application form, filled with the answers the app has. */
export const JobFormStateSchema = Type.Object({
  /** Whether the app can read the job's form from a source the user uses now. */
  canRead: Type.Boolean(),
  /** The form read last, or null when it has not been read. */
  form: Type.Union([JobFormSchema, Type.Null()]),
});

export type JobFormState = Static<typeof JobFormStateSchema>;

const wording = Type.String({ pattern: '\\S', maxLength: 2000 });
const value = Type.String({ pattern: '\\S', maxLength: 10_000 });
const place = Type.String({ pattern: '\\S', maxLength: 100 });

/** A reusable answer the user saved. */
export const SavedAnswerSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  /** The questions it answers, as forms word them. */
  wordings: Type.Array(Type.String()),
  /** One value, or several options of a multi-select question. */
  answer: Type.Array(Type.String()),
  sensitive: Type.Boolean(),
  /** Used only for jobs whose location names one of these; for every job when empty. */
  places: Type.Array(Type.String()),
  updatedAt: Type.String({ format: 'date-time' }),
});

export type SavedAnswer = Static<typeof SavedAnswerSchema>;

export const SaveAnswerRequestSchema = Type.Object({
  wordings: Type.Array(wording, { minItems: 1, maxItems: 50 }),
  answer: Type.Array(value, { minItems: 1, maxItems: 50 }),
  sensitive: Type.Boolean(),
  places: Type.Array(place, { maxItems: 20 }),
});

export type SaveAnswerRequest = Static<typeof SaveAnswerRequestSchema>;

/** The user's answer to one question of a job's form. */
export const AnswerQuestionRequestSchema = Type.Object({
  /**
   * The text, or the chosen options as the form words them; `["yes"]` gives a consent. Null fills
   * a sensitive optional question with the saved answer that fits it.
   */
  answer: Type.Union([Type.Array(value, { minItems: 1, maxItems: 50 }), Type.Null()]),
  /** Also save the answer for later applications, worded as this question. */
  save: Type.Optional(
    Type.Object({ sensitive: Type.Boolean(), places: Type.Array(place, { maxItems: 20 }) }),
  ),
});

export type AnswerQuestionRequest = Static<typeof AnswerQuestionRequestSchema>;

/** Use a saved answer for a question worded differently; the app remembers the wording. */
export const UseSavedAnswerRequestSchema = Type.Object({
  answerId: Type.String({ format: 'uuid' }),
});

export type UseSavedAnswerRequest = Static<typeof UseSavedAnswerRequestSchema>;
