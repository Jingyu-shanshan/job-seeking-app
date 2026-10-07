import Type, { type Static } from 'typebox';
import { FillSourceSchema, FormQuestionGroupSchema, FormQuestionKindSchema } from './forms.ts';

// The local runner (T17): a process on the user's computer that fills a job's application form in
// a visible browser window and stops before Submit. The user starts each fill from the job page;
// the runner takes it with a token the user issued, fills the answers the app gave it, and sends
// back what the form holds, with a screenshot. It never submits, and never writes an answer.

const date = Type.String({ format: 'date-time' });
const nullable = <T extends Type.TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** A token a runner signs in with. Only its hash is kept; the token itself is shown once. */
export const RunnerTokenSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  createdAt: date,
  lastUsedAt: nullable(date),
  revokedAt: nullable(date),
});

export type RunnerToken = Static<typeof RunnerTokenSchema>;

export const CreateRunnerTokenRequestSchema = Type.Object({
  name: Type.String({ pattern: '\\S', maxLength: 100 }),
});

export type CreateRunnerTokenRequest = Static<typeof CreateRunnerTokenRequestSchema>;

export const CreatedRunnerTokenSchema = Type.Object({
  /** The token, for the runner's `JSA_RUNNER_TOKEN`. The app cannot show it again. */
  token: Type.String(),
  runnerToken: RunnerTokenSchema,
});

export type CreatedRunnerToken = Static<typeof CreatedRunnerTokenSchema>;

/**
 * Where a fill is: waiting for a runner, being filled, paused until the user acts in the window,
 * filled and stopped before Submit, closed by the user (or their window closed), or failed.
 */
export const FillTaskStatusSchema = Type.Union([
  Type.Literal('waiting'),
  Type.Literal('filling'),
  Type.Literal('paused'),
  Type.Literal('filled'),
  Type.Literal('closed'),
  Type.Literal('failed'),
]);

export type FillTaskStatus = Static<typeof FillTaskStatusSchema>;

/** One question of the form as the user saw it filled when they started the fill. */
export const FillFieldSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  kind: FormQuestionKindSchema,
  group: FormQuestionGroupSchema,
  required: Type.Boolean(),
  /** What the runner puts in: the text, the chosen options, or the PDF's file name. [] for none. */
  answer: Type.Array(Type.String()),
  source: nullable(FillSourceSchema),
  /** The kept PDF the runner attaches. */
  documentPdfId: nullable(Type.String({ format: 'uuid' })),
});

export type FillField = Static<typeof FillFieldSchema>;

/** A fill as the runner takes it. */
export const RunnerTaskSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  /** The application form's page. */
  url: Type.String(),
  title: Type.String(),
  company: nullable(Type.String()),
  fields: Type.Array(FillFieldSchema),
});

export type RunnerTask = Static<typeof RunnerTaskSchema>;

/** How a field takes its value on the page. */
export const PageFieldKindSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('textarea'),
  /** A drop-down list of options, one or several. */
  Type.Literal('select'),
  /** A group of checkboxes, one per option. */
  Type.Literal('checkboxes'),
  /** One checkbox, such as a consent. */
  Type.Literal('checkbox'),
  Type.Literal('file'),
]);

export type PageFieldKind = Static<typeof PageFieldKindSchema>;

/** A field of the form as the page shows it now. */
export const PageFieldSchema = Type.Object({
  /** The app's key for one of its questions, else the page's own name for the field. */
  key: Type.String({ minLength: 1, maxLength: 200 }),
  label: Type.String({ maxLength: 2000 }),
  required: Type.Boolean(),
  kind: PageFieldKindSchema,
  /** The text, the chosen options, the attached files' names, or `checked` for a checkbox. */
  value: Type.Array(Type.String({ maxLength: 10_000 }), { maxItems: 1000 }),
});

export type PageField = Static<typeof PageFieldSchema>;

/** Something on the page only the user may deal with. */
export const PageBlockerSchema = Type.Union([Type.Literal('captcha'), Type.Literal('login')]);

export type PageBlocker = Static<typeof PageBlockerSchema>;

/** The largest screenshot the app keeps, in bytes. */
export const maxScreenshotBytes = 8 * 1024 * 1024;

/** What the runner saw on the page, after filling it or after the user's Continue. */
export const FormCheckRequestSchema = Type.Object({
  /** Whether the runner filled the form just before this. */
  filledNow: Type.Boolean(),
  blocker: nullable(PageBlockerSchema),
  fields: Type.Array(PageFieldSchema, { maxItems: 500 }),
  /** A PNG of the form (or of the page, when it has no form), in base64. */
  screenshot: Type.String({ minLength: 1, maxLength: Math.ceil(maxScreenshotBytes / 3) * 4 }),
});

export type FormCheckRequest = Static<typeof FormCheckRequestSchema>;

/** Why the runner could not go on, in words for the user. */
export const RunnerFailureSchema = Type.Object({
  message: Type.String({ pattern: '\\S', maxLength: 1000 }),
});

export type RunnerFailure = Static<typeof RunnerFailureSchema>;

/** A fill's status, as the runner follows it. */
export const RunnerTaskStateSchema = Type.Object({
  status: FillTaskStatusSchema,
  message: Type.String(),
});

export type RunnerTaskState = Static<typeof RunnerTaskStateSchema>;

/**
 * What a field holds compared with what the app put in: what the app filled, something else
 * (changed in the window, or the page did not take it), empty although the app filled it, a value
 * the app did not give (typed in the window), left empty as the app meant, or a question of the
 * app's that the page does not show.
 */
export const PreviewFieldStateSchema = Type.Union([
  Type.Literal('as_filled'),
  Type.Literal('changed'),
  Type.Literal('empty'),
  Type.Literal('from_window'),
  Type.Literal('left_empty'),
  Type.Literal('missing'),
]);

export type PreviewFieldState = Static<typeof PreviewFieldStateSchema>;

export const PreviewFieldSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  required: Type.Boolean(),
  /** What the form holds; [] when empty or not on the page. */
  value: Type.Array(Type.String()),
  /** What the app put in; [] when it put in nothing. */
  appAnswer: Type.Array(Type.String()),
  source: nullable(FillSourceSchema),
  state: PreviewFieldStateSchema,
});

export type PreviewField = Static<typeof PreviewFieldSchema>;

/** One look at the form by the runner: what each field holds, and a screenshot. */
export const FormCheckSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  checkedAt: date,
  blocker: nullable(PageBlockerSchema),
  fields: Type.Array(PreviewFieldSchema),
  screenshotUrl: Type.String(),
});

export type FormCheck = Static<typeof FormCheckSchema>;

export const FillTaskSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: FillTaskStatusSchema,
  /** What the user may want to know or do now. */
  message: Type.String(),
  url: Type.String(),
  createdAt: date,
  updatedAt: date,
  /** When a runner last asked about this fill. */
  runnerSeenAt: nullable(date),
  /** The runner's latest look at the form. */
  check: nullable(FormCheckSchema),
});

export type FillTask = Static<typeof FillTaskSchema>;

/** Filling a job's form with the runner. */
export const JobFillStateSchema = Type.Object({
  /** Why a fill cannot start now, or null when it can. */
  cannotStart: nullable(Type.String()),
  /** The job's latest fill. */
  task: nullable(FillTaskSchema),
  /** When a runner last asked the app for work, with any token. */
  runnerSeenAt: nullable(date),
});

export type JobFillState = Static<typeof JobFillStateSchema>;
