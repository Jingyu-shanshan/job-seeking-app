import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AnswerQuestionRequestSchema,
  JobFormStateSchema,
  UseSavedAnswerRequestSchema,
  type FormQuestion,
  type JobFormState,
} from '@jsa/shared';
import type { Pool } from 'pg';
import Type from 'typebox';
import { DiscoveryError } from '../discovery/adapter.ts';
import type { RateLimiter } from '../discovery/run.ts';
import { currentPdf } from '../documents/routes.ts';
import { httpError } from '../http-error.ts';
import { importSources, loadJobDetail, postingsOf } from '../jd/routes.ts';
import { loadProfile } from '../profile/routes.ts';
import {
  type FillContext,
  type JobAnswerState,
  fillForm,
  fitAnswer,
  placesCover,
  wordingKey,
} from '../rules/form-answers.ts';
import { insertAnswer, loadSavedAnswers, refuseDuplicate, tidyAnswer } from './answers.ts';

// A job's application form (T16): its questions as read from the job's source on the user's
// click, kept unchanged like a job text, and filled when it is read with the answers the app has
// (rules/form-answers.ts). The fill is never stored, so a changed saved answer, detail or kept PDF
// shows at once. The user's answers for one job are kept per question.

export interface JobFormRoutesOptions {
  pool: Pool;
  fetch: typeof globalThis.fetch;
  limiter: RateLimiter;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });
const QuestionParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  key: Type.String({ minLength: 1, maxLength: 200 }),
});

/** The sources the app can read this job's form from now. */
async function formSources(pool: Pool, jobId: string) {
  return importSources(await postingsOf(pool, jobId)).filter((s) => s.adapter.readForm);
}

interface FormRow {
  id: string;
  catalog_id: string;
  questions: FormQuestion[];
  captured_at: Date;
  last_captured_at: Date;
}

async function currentForm(pool: Pool, jobId: string): Promise<FormRow | undefined> {
  const { rows } = await pool.query<FormRow>(
    `select id, catalog_id, questions, captured_at, last_captured_at from job_form
     where job_id = $1 order by last_captured_at desc, captured_at desc limit 1`,
    [jobId],
  );
  return rows[0];
}

/** Everything the fill rules need about a job, or undefined when there is no such job. */
async function fillContext(pool: Pool, jobId: string): Promise<FillContext | undefined> {
  const job = await loadJobDetail(pool, jobId);
  if (!job) return undefined;
  const [profile, saved, answers] = await Promise.all([
    loadProfile(pool),
    loadSavedAnswers(pool),
    pool.query<{ question_key: string; label: string; answer: string[] | null }>(
      'select question_key, label, answer from job_form_answer where job_id = $1',
      [jobId],
    ),
  ]);
  const documents: FillContext['documents'] = { resume: null, cover_letter: null };
  // The latest drafts of the job's current text, as the job page lists them.
  for (const draft of job.snapshot?.drafts ?? []) {
    documents[draft.kind] = await currentPdf(pool, draft.id);
  }
  return {
    location: job.location,
    profile,
    saved,
    jobAnswers: new Map<string, JobAnswerState>(
      answers.rows.map((row) => [row.question_key, { label: row.label, answer: row.answer }]),
    ),
    documents,
  };
}

async function formState(pool: Pool, jobId: string): Promise<JobFormState> {
  const context = await fillContext(pool, jobId);
  if (!context) throw httpError(404, 'There is no such job.');
  const [sources, form] = await Promise.all([formSources(pool, jobId), currentForm(pool, jobId)]);
  return {
    canRead: sources.length > 0,
    form: form
      ? {
          id: form.id,
          catalogId: form.catalog_id,
          readAt: form.captured_at.toISOString(),
          lastReadAt: form.last_captured_at.toISOString(),
          fills: fillForm(form.questions, context),
        }
      : null,
  };
}

/** The question of the job's current form with this key, or a 404. */
async function questionOf(pool: Pool, jobId: string, key: string): Promise<FormQuestion> {
  const form = await currentForm(pool, jobId);
  const question = form?.questions.find((q) => q.key === key);
  if (!question) throw httpError(404, 'The job’s form has no such question.');
  return question;
}

function refuseFiles(question: FormQuestion) {
  if (question.kind === 'file') {
    throw httpError(400, 'The app attaches only the resume and cover letter PDFs you kept.');
  }
}

export const jobFormRoutes: FastifyPluginAsyncTypebox<JobFormRoutesOptions> = async (
  app,
  { pool, fetch, limiter },
) => {
  app.get(
    '/jobs/:id/form',
    { schema: { params: IdParamsSchema, response: { 200: JobFormStateSchema } } },
    (request) => formState(pool, request.params.id),
  );

  // One request to the job's source, on the user's click.
  app.post(
    '/jobs/:id/form',
    { schema: { params: IdParamsSchema, response: { 200: JobFormStateSchema } } },
    async (request) => {
      const jobId = request.params.id;
      const exists = await pool.query('select 1 from job where id = $1', [jobId]);
      if (!exists.rowCount) throw httpError(404, 'There is no such job.');
      const [source] = await formSources(pool, jobId);
      if (!source) {
        throw httpError(
          409,
          'None of the sources you use can give this job’s application form. The app reads forms from Greenhouse job boards.',
        );
      }
      const { posting, entry, adapter } = source;
      if (entry.rateLimit) await limiter.wait(entry.id, entry.rateLimit);
      let questions: FormQuestion[];
      try {
        questions = await adapter.readForm!(posting.param, posting.external_id, fetch);
      } catch (err) {
        if (!(err instanceof DiscoveryError)) throw err;
        request.log.warn({ err, sourceId: posting.source_id }, 'reading a job form failed');
        throw httpError(502, err.message);
      }
      await pool.query(
        `insert into job_form (job_id, catalog_id, questions) values ($1, $2, $3)
         on conflict (job_id, md5(questions::text)) do update set last_captured_at = now()`,
        [jobId, entry.id, JSON.stringify(questions)],
      );
      return formState(pool, jobId);
    },
  );

  // The user's answer to one question for this job, and if they want, saved for later.
  app.put(
    '/jobs/:id/form/answers/:key',
    {
      schema: {
        params: QuestionParamsSchema,
        body: AnswerQuestionRequestSchema,
        response: { 200: JobFormStateSchema },
      },
    },
    async (request) => {
      const { id: jobId, key } = request.params;
      const { answer, save } = request.body;
      const question = await questionOf(pool, jobId, key);
      refuseFiles(question);
      let saved: string[] | undefined;
      if (answer) {
        const fitted = fitAnswer(question, answer);
        if (!fitted.ok) throw httpError(400, fitted.reason);
        saved = question.kind === 'single' || question.kind === 'multi' ? fitted.values : answer;
      } else if (question.kind === 'consent') {
        throw httpError(400, 'A consent is given for this application only.');
      }
      if (save) {
        if (question.kind === 'consent') {
          throw httpError(400, 'A consent is given for one application, so it is not saved.');
        }
        if (!saved) throw httpError(400, 'Give the answer to save.');
        const later = tidyAnswer({ wordings: [question.label], answer: saved, ...save });
        await refuseDuplicate(pool, later);
        await insertAnswer(pool, later);
      }
      await pool.query(
        `insert into job_form_answer (job_id, question_key, label, answer) values ($1, $2, $3, $4)
         on conflict (job_id, question_key)
           do update set label = excluded.label, answer = excluded.answer, updated_at = now()`,
        [jobId, key, question.label, answer?.map((value) => value.trim()) ?? null],
      );
      return formState(pool, jobId);
    },
  );

  app.delete(
    '/jobs/:id/form/answers/:key',
    { schema: { params: QuestionParamsSchema, response: { 200: JobFormStateSchema } } },
    async (request) => {
      const { id: jobId, key } = request.params;
      const { rowCount } = await pool.query(
        'delete from job_form_answer where job_id = $1 and question_key = $2',
        [jobId, key],
      );
      if (!rowCount) throw httpError(404, 'You gave no answer to this question for this job.');
      return formState(pool, jobId);
    },
  );

  // A saved answer for a question its wordings do not have yet. The app remembers the wording,
  // so the saved answer fills this question by itself on later forms.
  app.post(
    '/jobs/:id/form/answers/:key/saved',
    {
      schema: {
        params: QuestionParamsSchema,
        body: UseSavedAnswerRequestSchema,
        response: { 200: JobFormStateSchema },
      },
    },
    async (request) => {
      const { id: jobId, key } = request.params;
      const question = await questionOf(pool, jobId, key);
      refuseFiles(question);
      if (question.kind === 'consent') {
        throw httpError(400, 'A consent is given for this application only.');
      }
      const context = (await fillContext(pool, jobId))!;
      const chosen = context.saved.find((s) => s.id === request.body.answerId);
      if (!chosen) throw httpError(404, 'There is no such saved answer.');
      if (!placesCover(chosen.places, context.location)) {
        throw httpError(
          409,
          `This saved answer is only for jobs whose location names ${chosen.places.join(', ')}.`,
        );
      }
      const fitted = fitAnswer(question, chosen.answer);
      if (!fitted.ok) throw httpError(409, `This saved answer does not fit: ${fitted.reason}`);

      const wording = wordingKey(question.label);
      const others = context.saved.filter(
        (s) =>
          s.id !== chosen.id &&
          s.wordings.some((w) => wordingKey(w) === wording) &&
          placesCover(s.places, context.location),
      );
      const sensitive =
        chosen.sensitive || question.group === 'compliance' || question.group === 'demographic';
      // With another saved answer for this wording, a remembered wording would leave two to
      // choose from every time: the choice is kept for this job only.
      const forThisJob = others.length
        ? fitted.values
        : sensitive && !question.required
          ? null
          : undefined;
      const remember = !others.length && !chosen.wordings.some((w) => wordingKey(w) === wording);
      if (remember && chosen.wordings.length >= 50) {
        throw httpError(409, 'This saved answer has 50 wordings already. Remove some first.');
      }
      if (remember) {
        await pool.query(
          `update form_answer set wordings = array_append(wordings, $2), updated_at = now()
           where id = $1`,
          [chosen.id, question.label],
        );
      }
      if (forThisJob === undefined) {
        await pool.query('delete from job_form_answer where job_id = $1 and question_key = $2', [
          jobId,
          key,
        ]);
      } else {
        await pool.query(
          `insert into job_form_answer (job_id, question_key, label, answer) values ($1, $2, $3, $4)
           on conflict (job_id, question_key)
             do update set label = excluded.label, answer = excluded.answer, updated_at = now()`,
          [jobId, key, question.label, forThisJob],
        );
      }
      return formState(pool, jobId);
    },
  );
};
