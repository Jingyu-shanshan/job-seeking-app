import Type, { type Static } from 'typebox';
import { maxAlertEmailLength } from './limits.ts';

// Job-alert emails (T20): the user pastes an email's source or uploads it as an .eml file, and the
// app reads the jobs it lists. Everything in an email is untrusted text.

/** Body of `POST /api/alert-emails`: one email's full source, headers included. */
export const ImportAlertEmailRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: maxAlertEmailLength }),
});

export type ImportAlertEmailRequest = Static<typeof ImportAlertEmailRequestSchema>;

/**
 * How the app knew a job read from an email:
 * - `new`: it did not have the job.
 * - `address`: it had a job at that address, from an earlier email, a save from the desktop app
 *   or a job board.
 * - `same_job`: it had a job with the same company and title, from a job board, a save or
 *   another alert, and only one.
 */
export const AlertJobMatchSchema = Type.Union([
  Type.Literal('new'),
  Type.Literal('address'),
  Type.Literal('same_job'),
]);

export type AlertJobMatch = Static<typeof AlertJobMatchSchema>;

/** One job read from an email. */
export const AlertJobSchema = Type.Object({
  jobId: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  /**
   * The job's page on the site, without the email's tracking or sign-in parameters; null when
   * the email links to it only through a tracker the app cannot read.
   */
  url: Type.Union([Type.String(), Type.Null()]),
  match: AlertJobMatchSchema,
  /** True when one of the user's job boards lists the job, so the app can read its text there. */
  onBoard: Type.Boolean(),
});

export type AlertJob = Static<typeof AlertJobSchema>;

/** Response of `POST /api/alert-emails`. */
export const ImportAlertEmailResponseSchema = Type.Object({
  imported: Type.Boolean(),
  /** Why the email was not imported, or why no job was read from it; '' otherwise. */
  reason: Type.String(),
  /** The job-alert source the email came from; null when the sender is not one. */
  catalogId: Type.Union([Type.String(), Type.Null()]),
  sender: Type.String(),
  subject: Type.String(),
  sentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** True when the same email was imported before. */
  again: Type.Boolean(),
  jobs: Type.Array(AlertJobSchema),
  /** Links to jobs in the email whose title could not be read. */
  unreadable: Type.Integer({ minimum: 0 }),
});

export type ImportAlertEmailResponse = Static<typeof ImportAlertEmailResponseSchema>;

/** One imported email, as `GET /api/alert-emails` lists it. */
export const AlertEmailSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  catalogId: Type.String(),
  subject: Type.String(),
  sentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  jobs: Type.Integer({ minimum: 0 }),
  unreadable: Type.Integer({ minimum: 0 }),
  lastImportedAt: Type.String({ format: 'date-time' }),
});

export type AlertEmail = Static<typeof AlertEmailSchema>;

/** Response of `GET /api/alert-emails`: the emails imported last, newest import first. */
export const AlertEmailsResponseSchema = Type.Object({
  emails: Type.Array(AlertEmailSchema),
});

export type AlertEmailsResponse = Static<typeof AlertEmailsResponseSchema>;

/** A job-alert email that listed a job, as the job page shows it. */
export const AlertListingSchema = Type.Object({
  catalogId: Type.String(),
  /** The source's name, e.g. "LinkedIn". */
  name: Type.String(),
  /** The subject of the newest email that listed the job, which usually names the alert. */
  subject: Type.String(),
  sentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  firstSeenAt: Type.String({ format: 'date-time' }),
  /** The job's page on the site; null when the email gave no readable link. */
  url: Type.Union([Type.String(), Type.Null()]),
  /** Other text the email showed with the job, such as pay or a line of description. */
  details: Type.String(),
});

export type AlertListing = Static<typeof AlertListingSchema>;
