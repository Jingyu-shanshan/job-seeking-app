import type { FormQuestion, FormQuestionGroup, FormQuestionKind } from '@jsa/shared';
import { decodeHTML } from 'entities';
import Type, { type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  DiscoveryError,
  checkJobText,
  fetchJson,
  fitLocation,
  httpsUrl,
  maybe,
  type Adapter,
} from './adapter.ts';
import { htmlToText } from './html.ts';

// Greenhouse's public Job Board API (https://docs.greenhouse.io/job-board.html, checked
// 2026-10-01): one request lists every published job of a board. No key, no login. Board names
// are not case-sensitive. Only the fields the app uses are checked; others are ignored. The job
// text (`?content=true`) is not requested here: it goes into a JD snapshot in T05. A job's
// application form (`?questions=true`, the same API) is read on the user's click (T16).

const JobSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  title: Type.String({ pattern: '\\S', maxLength: 1000 }),
  company_name: maybe(Type.String({ maxLength: 1000 })),
  location: maybe(Type.Object({ name: maybe(Type.String()) })),
  absolute_url: maybe(Type.String()),
  first_published: maybe(Type.String({ format: 'date-time' })),
});

const BoardSchema = Type.Object({
  jobs: Type.Array(JobSchema, { maxItems: 10_000 }),
});

const JobWithContentSchema = Type.Intersect([JobSchema, Type.Object({ content: Type.String() })]);

function describe(name: string, job: Static<typeof JobSchema>) {
  return {
    title: job.title.trim(),
    company: job.company_name?.trim() || null,
    location: fitLocation(job.location?.name?.trim() ?? ''),
    // Usually the board's page; some companies point it at their own careers site.
    url: httpsUrl(job.absolute_url) ?? `https://job-boards.greenhouse.io/${name}/jobs/${job.id}`,
  };
}

const ValuesSchema = Type.Array(Type.Object({ label: Type.String() }), { maxItems: 1000 });

const QuestionSchema = Type.Object({
  label: Type.String(),
  required: maybe(Type.Boolean()),
  description: maybe(Type.String()),
  fields: Type.Array(
    Type.Object({ name: Type.String(), type: Type.String(), values: maybe(ValuesSchema) }),
    { maxItems: 20 },
  ),
});

const questions = Type.Array(QuestionSchema, { maxItems: 500 });

const FormSchema = Type.Object({
  questions: maybe(questions),
  location_questions: maybe(questions),
  compliance: maybe(Type.Array(Type.Object({ questions: maybe(questions) }), { maxItems: 50 })),
  demographic_questions: maybe(
    Type.Object({
      questions: maybe(
        Type.Array(
          Type.Object({
            id: Type.Integer(),
            label: Type.String(),
            required: maybe(Type.Boolean()),
            type: Type.String(),
            answer_options: maybe(ValuesSchema),
          }),
          { maxItems: 500 },
        ),
      ),
    }),
  ),
  data_compliance: maybe(
    Type.Array(
      Type.Object({
        type: maybe(Type.String()),
        requires_consent: maybe(Type.Boolean()),
        requires_processing_consent: maybe(Type.Boolean()),
        requires_retention_consent: maybe(Type.Boolean()),
        demographic_data_consent_applies: maybe(Type.Boolean()),
      }),
      { maxItems: 10 },
    ),
  ),
});

const fieldKinds: Record<string, FormQuestionKind> = {
  input_text: 'text',
  textarea: 'textarea',
  input_file: 'file',
  multi_value_single_select: 'single',
  multi_value_multi_select: 'multi',
};

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const plain = (text: string, max: number) => cut(text.trim().replace(/\s+/g, ' '), max);

function kindOf(type: string): FormQuestionKind {
  const kind = fieldKinds[type];
  if (!kind) {
    throw new DiscoveryError(
      `Greenhouse’s form has a field of a kind the app does not know: ${type}.`,
    );
  }
  return kind;
}

const optionsOf = (values: Static<typeof ValuesSchema> | null | undefined) => [
  ...new Set((values ?? []).map((v) => plain(v.label, 2000)).filter((label) => label !== '')),
];

// The consents a form asks for: Greenhouse gives only which ones, not the form's words for them.
const consents = [
  ['gdpr_processing_consent_given', 'Consent to the processing of your data for this application'],
  ['gdpr_retention_consent_given', 'Consent to keeping your data after this application'],
  ['gdpr_consent_given', 'Consent to the processing of your data (GDPR)'],
  [
    'gdpr_demographic_data_consent_given',
    'Consent to the processing of your answers to the demographic questions',
  ],
] as const;

/** A job's application form in the app's own shape: every question a user may be asked. */
export function greenhouseForm(body: Static<typeof FormSchema>): FormQuestion[] {
  const found: FormQuestion[] = [];
  const add = (question: FormQuestion) => {
    // Field names are unique within a form; keep the first if Greenhouse repeats one.
    if (!found.some((q) => q.key === question.key)) found.push(question);
  };
  const addAll = (list: Static<typeof questions> | null | undefined, group: FormQuestionGroup) => {
    for (const q of list ?? []) {
      // A resume question has a file and a text field; the first one that shows is the answer.
      const field = q.fields.find((f) => f.type !== 'input_hidden');
      const key = field && plain(field.name, 200);
      if (!field || !key) continue;
      add({
        key,
        label: plain(q.label, 2000) || key,
        description: cut(htmlToText(decodeHTML(q.description ?? '')), 10_000),
        required: q.required ?? false,
        kind: kindOf(field.type),
        options: optionsOf(field.values),
        group,
      });
    }
  };
  addAll(body.questions, 'questions');
  addAll(body.location_questions, 'location');
  for (const block of body.compliance ?? []) addAll(block.questions, 'compliance');
  const demographic = body.demographic_questions?.questions ?? [];
  for (const q of demographic) {
    const kind = kindOf(q.type);
    add({
      key: `demographic_${q.id}`,
      label: plain(q.label, 2000) || `Demographic question ${q.id}`,
      description: '',
      required: q.required ?? false,
      kind,
      options: optionsOf(q.answer_options),
      group: 'demographic',
    });
  }
  for (const rules of body.data_compliance ?? []) {
    const separate = rules.requires_processing_consent || rules.requires_retention_consent;
    const asked: Record<(typeof consents)[number][0], boolean> = {
      gdpr_processing_consent_given: rules.requires_processing_consent ?? false,
      gdpr_retention_consent_given: rules.requires_retention_consent ?? false,
      gdpr_consent_given: !separate && (rules.requires_consent ?? false),
      gdpr_demographic_data_consent_given:
        (rules.demographic_data_consent_applies ?? false) && demographic.length > 0,
    };
    for (const [key, label] of consents) {
      if (!asked[key]) continue;
      add({
        key,
        label,
        description: 'The form asks for this consent; Greenhouse does not give the app its words.',
        required: key !== 'gdpr_demographic_data_consent_given',
        kind: 'consent',
        options: [],
        group: 'consent',
      });
    }
  }
  return found;
}

async function get(url: string, fetch: typeof globalThis.fetch, notFound: string) {
  try {
    return await fetchJson(fetch, url);
  } catch (err) {
    if (err instanceof DiscoveryError && err.status === 404) throw new DiscoveryError(notFound);
    throw err;
  }
}

export const greenhouseBoard: Adapter = {
  async listJobs(board, fetch) {
    const name = encodeURIComponent(board);
    const body = await get(
      `https://boards-api.greenhouse.io/v1/boards/${name}/jobs`,
      fetch,
      `Greenhouse has no job board called ${board}.`,
    );
    if (!Value.Check(BoardSchema, body)) {
      throw new DiscoveryError('Greenhouse answered with something other than a list of jobs.');
    }
    return body.jobs.map((job) => ({
      externalId: String(job.id),
      ...describe(name, job),
      publishedAt: job.first_published ?? null,
    }));
  },

  async readJob(board, externalId, fetch) {
    const name = encodeURIComponent(board);
    const body = await get(
      `https://boards-api.greenhouse.io/v1/boards/${name}/jobs/${encodeURIComponent(externalId)}`,
      fetch,
      `The Greenhouse board ${board} no longer lists this job.`,
    );
    if (!Value.Check(JobWithContentSchema, body)) {
      throw new DiscoveryError('Greenhouse answered with something other than a job.');
    }
    return {
      ...describe(name, body),
      text: checkJobText(htmlToText(decodeHTML(body.content)), 'Greenhouse'),
    };
  },

  async readForm(board, externalId, fetch) {
    const name = encodeURIComponent(board);
    const body = await get(
      `https://boards-api.greenhouse.io/v1/boards/${name}/jobs/${encodeURIComponent(externalId)}?questions=true`,
      fetch,
      `The Greenhouse board ${board} no longer lists this job.`,
    );
    if (!Value.Check(FormSchema, body)) {
      throw new DiscoveryError(
        'Greenhouse answered with something other than an application form.',
      );
    }
    const form = greenhouseForm(body);
    if (form.length === 0)
      throw new DiscoveryError('Greenhouse gives no application form for this job.');
    return form;
  },
};
