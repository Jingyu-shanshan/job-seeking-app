import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  Draft,
  DraftDocument,
  Fact,
  FormFill,
  JobDetail,
  JobFormState,
  JobsResponse,
  PdfCheck,
  SavedAnswer,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { documentPieces } from '../rules/document.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeDeepSeek } from '../testing/deepseek.ts';
import { fakeGreenhouse, greenhouseForm, type FakeJob } from '../testing/greenhouse.ts';
import { pdfOf } from '../testing/pdf.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

const profile = {
  name: 'Test Person',
  email: 'test.person@example.com',
  phone: '+358 40 000 0000',
  location: 'Helsinki',
  links: ['https://www.linkedin.com/in/test-person/'],
};

const role = 'Backend developer at Acme Oy, 2021-03 – 2024-06';

interface SentDraft {
  facts: { ref: string; text: string }[];
}

// A short resume that passes the checks: every statement is the cited fact's own words.
const resume = (sent: SentDraft) => {
  const ref = sent.facts.find((f) => f.text === role)?.ref ?? 'F404';
  return {
    headline: { text: 'Backend developer', facts: [ref] },
    summary: [],
    experience: [{ title: { text: role, facts: [ref] }, bullets: [] }],
  };
};

/** Lines of at most `width` characters, broken at spaces, as a PDF wraps them. */
const wrapped = (pieces: readonly string[], width = 60) =>
  pieces.flatMap((piece) => {
    const lines: string[] = [];
    let line = '';
    for (const word of piece.split(' ')) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    return [...lines, line];
  });

describe('form answers', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const boards: Parameters<typeof fakeGreenhouse>[0] = {};
  const greenhouse = fakeGreenhouse(boards);
  const deepseek = fakeDeepSeek(async () => {
    const sent = JSON.parse(deepseek.requests.at(-1)!.body.messages[1]!.content) as SentDraft;
    return Response.json({
      choices: [{ message: { content: JSON.stringify(resume(sent)) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  }, greenhouse.fetch);

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: deepseek.fetch,
      deepseekApiKey: 'sk-test',
    });
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: account.email, password: account.password },
    });
    const setCookie = [signIn.headers['set-cookie'] ?? []].flat();
    cookie = setCookie.find((c) => c.startsWith('better-auth.session_token='))!.split(';', 1)[0]!;
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  const call = (options: InjectOptions) =>
    app.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const ok = async <T>(options: InjectOptions, status = 200) => {
    const res = await call(options);
    assert.equal(res.statusCode, status, res.body);
    return res.json<T>();
  };

  const refused = async (options: InjectOptions, status: number, message?: string) => {
    const res = await call(options);
    assert.equal(res.statusCode, status, res.body);
    if (message) assert.equal(res.json<{ message: string }>().message, message);
  };

  const count = async (from: string) =>
    Number((await pool.query(`select count(*) from ${from}`)).rows[0].count);

  const saveAnswer = (payload: object) =>
    ok<SavedAnswer>({ method: 'POST', url: '/api/answers', payload }, 201);

  const formOf = (jobId: string) =>
    ok<JobFormState>({ method: 'GET', url: `/api/jobs/${jobId}/form` });
  const readForm = (jobId: string) =>
    ok<JobFormState>({ method: 'POST', url: `/api/jobs/${jobId}/form` });
  const answer = (jobId: string, key: string, payload: object) =>
    call({ method: 'PUT', url: `/api/jobs/${jobId}/form/answers/${key}`, payload });
  const useSaved = (jobId: string, key: string, answerId: string) =>
    call({
      method: 'POST',
      url: `/api/jobs/${jobId}/form/answers/${key}/saved`,
      payload: { answerId },
    });

  const fill = (state: JobFormState, key: string): FormFill =>
    state.form!.fills.find((f) => f.question.key === key)!;
  const brief = (f: FormFill) => [f.status, f.answer, f.source];

  const jobs: Record<string, string> = {};

  test('saved answers: kept tidy, one per wording and places, changed and deleted', async () => {
    assert.deepEqual(await ok<SavedAnswer[]>({ method: 'GET', url: '/api/answers' }), []);
    const notice = await saveAnswer({
      wordings: ['  What is your  notice period? ', 'what is your notice period', 'Notice period'],
      answer: [' One month ', 'One month'],
      sensitive: false,
      places: [' Finland', 'finland '],
    });
    assert.deepEqual(
      { ...notice, id: undefined, updatedAt: undefined },
      {
        id: undefined,
        updatedAt: undefined,
        wordings: ['What is your notice period?', 'Notice period'],
        answer: ['One month'],
        sensitive: false,
        places: ['Finland'],
      },
    );
    await refused(
      {
        method: 'POST',
        url: '/api/answers',
        payload: {
          wordings: ['Notice period?'],
          answer: ['Two months'],
          sensitive: false,
          places: ['FINLAND'],
        },
      },
      409,
      'Another saved answer already answers “Notice period” for the same places. Change that one, or give this one other places.',
    );
    // The same question for other places is another answer.
    const sweden = await saveAnswer({
      wordings: ['Notice period'],
      answer: ['Three months'],
      sensitive: false,
      places: ['Sweden'],
    });
    await refused(
      {
        method: 'POST',
        url: '/api/answers',
        payload: { wordings: ['???'], answer: ['x'], sensitive: false, places: [] },
      },
      400,
      'A question needs letters or digits: “???”.',
    );
    for (const payload of [
      { wordings: [], answer: ['x'], sensitive: false, places: [] },
      { wordings: ['Q'], answer: [' '], sensitive: false, places: [] },
      { wordings: ['Q'], answer: ['x'], places: [] },
    ]) {
      await refused({ method: 'POST', url: '/api/answers', payload }, 400);
    }

    const changed = await ok<SavedAnswer>({
      method: 'PUT',
      url: `/api/answers/${sweden.id}`,
      payload: {
        wordings: ['Notice period'],
        answer: ['Two months'],
        sensitive: true,
        places: ['Sweden', 'Norway'],
      },
    });
    assert.deepEqual(
      [changed.answer, changed.sensitive, changed.places],
      [['Two months'], true, ['Sweden', 'Norway']],
    );
    await refused(
      {
        method: 'PUT',
        url: `/api/answers/${sweden.id}`,
        payload: {
          wordings: ['Notice period'],
          answer: ['x'],
          sensitive: false,
          places: ['Finland'],
        },
      },
      409,
    );
    await refused(
      {
        method: 'PUT',
        url: `/api/answers/${uuid}`,
        payload: { wordings: ['Q'], answer: ['x'], sensitive: false, places: [] },
      },
      404,
    );
    assert.equal(
      (await call({ method: 'DELETE', url: `/api/answers/${sweden.id}` })).statusCode,
      204,
    );
    await refused({ method: 'DELETE', url: `/api/answers/${sweden.id}` }, 404);
    assert.deepEqual(
      (await ok<SavedAnswer[]>({ method: 'GET', url: '/api/answers' })).map((a) => a.id),
      [notice.id],
    );
  });

  test('a job’s form: read from its Greenhouse board on a click, kept once per distinct form', async () => {
    await ok({ method: 'PUT', url: '/api/profile', payload: profile });
    await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'acme' },
    });
    const listed: FakeJob[] = [
      { id: 7, title: 'Platform Engineer', location: 'Helsinki, Finland' },
      { id: 8, title: 'Data Engineer', location: 'Stockholm, Sweden' },
    ];
    boards['acme'] = listed;
    await call({ method: 'POST', url: '/api/discovery-runs', payload: {} });
    const { jobs: found } = await ok<JobsResponse>({ method: 'GET', url: '/api/jobs' });
    jobs.helsinki = found.find((j) => j.title === 'Platform Engineer')!.id;
    jobs.stockholm = found.find((j) => j.title === 'Data Engineer')!.id;

    assert.deepEqual(await formOf(jobs.helsinki), { canRead: true, form: null });
    const requests = greenhouse.requested.length;
    const state = await readForm(jobs.helsinki);
    assert.deepEqual(greenhouse.requested.slice(requests), [
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/7?questions=true',
    ]);
    assert.equal(state.form!.catalogId, 'greenhouse_board');
    assert.deepEqual(
      state.form!.fills.map((f) => [f.question.key, f.status, f.source]),
      [
        ['first_name', 'needs_answer', null],
        ['last_name', 'needs_answer', null],
        ['email', 'filled', 'profile'],
        ['phone', 'filled', 'profile'],
        ['resume', 'needs_answer', null],
        ['cover_letter', 'optional_empty', null],
        ['question_101', 'filled', 'profile'],
        ['question_102', 'needs_answer', null],
        // The saved notice period is for jobs in Finland.
        ['question_103', 'filled', 'saved'],
        ['location', 'filled', 'profile'],
        ['gender', 'optional_empty', null],
        ['gdpr_processing_consent_given', 'needs_answer', null],
      ],
    );
    assert.deepEqual(fill(state, 'question_101').answer, [profile.links[0]]);
    assert.equal(
      fill(state, 'resume').note,
      'Keep a PDF of this job’s resume on its document page.',
    );
    assert.equal(fill(state, 'question_102').looksSensitive, true);
    assert.equal(fill(state, 'first_name').looksSensitive, false);

    // The same form again: the same row, read again.
    const again = await readForm(jobs.helsinki);
    assert.equal(again.form!.id, state.form!.id);
    assert.notEqual(again.form!.lastReadAt, state.form!.lastReadAt);
    assert.equal(await count('job_form'), 1);
    // A changed form is kept next to the old one and is the current one.
    listed[0]!.form = {
      ...greenhouseForm,
      questions: [...greenhouseForm.questions.slice(0, 3), greenhouseForm.questions[7]],
    };
    const changed = await readForm(jobs.helsinki);
    assert.notEqual(changed.form!.id, state.form!.id);
    assert.equal(changed.form!.fills.length, 4 + 1 + 1 + 1);
    assert.equal(await count('job_form'), 2);
    delete listed[0]!.form;
    assert.equal((await readForm(jobs.helsinki)).form!.id, state.form!.id);

    // Details are read when the form is: a change shows at once.
    await ok({ method: 'PUT', url: '/api/profile', payload: { ...profile, phone: '' } });
    assert.deepEqual(brief(fill(await formOf(jobs.helsinki), 'phone')), [
      'optional_empty',
      [],
      null,
    ]);
    await ok({ method: 'PUT', url: '/api/profile', payload: profile });
  });

  test('answers for this job come first, and can be saved for later applications', async () => {
    const first = await answer(jobs.helsinki!, 'first_name', {
      answer: [' Test '],
      save: { sensitive: false, places: [] },
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(brief(fill(first.json(), 'first_name')), ['filled', ['Test'], 'job']);
    assert.equal(fill(first.json(), 'first_name').answeredForJob, true);
    // Saved under the form's wording: the next form fills it by itself.
    const saved = await ok<SavedAnswer[]>({ method: 'GET', url: '/api/answers' });
    assert.deepEqual(
      saved.map((a) => [a.wordings, a.answer]),
      [
        [['What is your notice period?', 'Notice period'], ['One month']],
        [['First Name'], ['Test']],
      ],
    );
    const stockholm = await readForm(jobs.stockholm!);
    assert.deepEqual(brief(fill(stockholm, 'first_name')), ['filled', ['Test'], 'saved']);
    assert.equal(fill(stockholm, 'question_103').status, 'needs_answer');
    assert.match(
      fill(stockholm, 'question_103').note,
      /only for jobs whose location names “Finland”/,
    );

    // Only for this job: the saved answer stays as it is.
    const last = (
      await answer(jobs.helsinki!, 'last_name', { answer: ['Person'] })
    ).json<JobFormState>();
    assert.deepEqual(brief(fill(last, 'last_name')), ['filled', ['Person'], 'job']);
    assert.equal(fill(await formOf(jobs.stockholm!), 'last_name').status, 'needs_answer');

    // An option as the form words it; anything else is refused.
    const visa = await answer(jobs.helsinki!, 'question_102', { answer: ['no'] });
    assert.deepEqual(brief(fill(visa.json(), 'question_102')), ['filled', ['No'], 'job']);
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/question_102`,
        payload: { answer: ['Maybe'] },
      },
      400,
      '“Maybe” is not one of its options.',
    );
    // Saving a second answer to a saved wording for the same places is refused, and nothing is kept.
    const before = await count('job_form_answer');
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.stockholm}/form/answers/first_name`,
        payload: { answer: ['Testi'], save: { sensitive: false, places: [] } },
      },
      409,
    );
    assert.equal(await count('job_form_answer'), before);

    // A consent is given for this job only.
    const consent = await answer(jobs.helsinki!, 'gdpr_processing_consent_given', {
      answer: ['yes'],
    });
    assert.deepEqual(brief(fill(consent.json(), 'gdpr_processing_consent_given')), [
      'filled',
      ['Consent given'],
      'job',
    ]);
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.stockholm}/form/answers/gdpr_processing_consent_given`,
        payload: { answer: ['yes'], save: { sensitive: false, places: [] } },
      },
      400,
      'A consent is given for one application, so it is not saved.',
    );

    // Taken back: the saved answer fills it again.
    const back = await ok<JobFormState>({
      method: 'DELETE',
      url: `/api/jobs/${jobs.helsinki}/form/answers/first_name`,
    });
    assert.deepEqual(brief(fill(back, 'first_name')), ['filled', ['Test'], 'saved']);
    assert.equal(fill(back, 'first_name').answeredForJob, false);
    await refused(
      { method: 'DELETE', url: `/api/jobs/${jobs.helsinki}/form/answers/first_name` },
      404,
    );
  });

  test('a saved answer for another wording: remembered for later forms, refused when it does not fit', async () => {
    const sponsorship = await saveAnswer({
      wordings: ['Do you need visa sponsorship?'],
      answer: ['No'],
      sensitive: true,
      places: [],
    });
    const notice = (await ok<SavedAnswer[]>({ method: 'GET', url: '/api/answers' }))[0]!;
    // Stockholm is not in Finland.
    const outside = await useSaved(jobs.stockholm!, 'question_103', notice.id);
    assert.equal(outside.statusCode, 409);
    assert.equal(
      outside.json<{ message: string }>().message,
      'This saved answer is only for jobs whose location names Finland.',
    );
    // In Helsinki it is, but a text answer is not one of the options of a yes/no question.
    const misfit = await useSaved(jobs.helsinki!, 'question_102', notice.id);
    assert.equal(misfit.statusCode, 409);
    assert.equal(
      misfit.json<{ message: string }>().message,
      'This saved answer does not fit: “One month” is not one of its options.',
    );

    const used = await useSaved(jobs.stockholm!, 'question_102', sponsorship.id);
    assert.equal(used.statusCode, 200, used.body);
    const visa = fill(used.json(), 'question_102');
    assert.deepEqual(
      [...brief(visa), visa.sensitive, visa.savedAnswerId],
      ['filled', ['No'], 'saved', true, sponsorship.id],
    );
    const remembered = (await ok<SavedAnswer[]>({ method: 'GET', url: '/api/answers' })).find(
      (a) => a.id === sponsorship.id,
    )!;
    assert.deepEqual(remembered.wordings, [
      'Do you need visa sponsorship?',
      'Will you now or in the future require sponsorship for a visa?',
    ]);
    // The Helsinki job's own answer still comes first.
    assert.deepEqual(brief(fill(await formOf(jobs.helsinki!), 'question_102')), [
      'filled',
      ['No'],
      'job',
    ]);
    await refused(
      {
        method: 'POST',
        url: `/api/jobs/${jobs.stockholm}/form/answers/resume/saved`,
        payload: { answerId: sponsorship.id },
      },
      400,
    );
    await refused(
      {
        method: 'POST',
        url: `/api/jobs/${jobs.stockholm}/form/answers/question_102/saved`,
        payload: { answerId: uuid },
      },
      404,
    );
  });

  test('a sensitive answer fills an optional question only when the user chooses so for this job', async () => {
    const gender = await saveAnswer({
      wordings: ['Gender'],
      answer: ['Decline to self identify'],
      // Self-identification questions are sensitive whatever the answer says.
      sensitive: false,
      places: [],
    });
    const held = fill(await formOf(jobs.helsinki!), 'gender');
    assert.deepEqual(
      [held.status, held.answer, held.savedAnswerId, held.sensitive],
      ['held_back', [], gender.id, true],
    );
    const chosen = (await answer(jobs.helsinki!, 'gender', { answer: null })).json<JobFormState>();
    assert.deepEqual(brief(fill(chosen, 'gender')), [
      'filled',
      ['Decline To Self Identify'],
      'saved',
    ]);
    assert.equal(fill(await formOf(jobs.stockholm!), 'gender').status, 'held_back');
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/gdpr_processing_consent_given`,
        payload: { answer: null },
      },
      400,
    );
  });

  test('the resume PDF kept for the job fills its file question', async () => {
    const fact = await ok<Fact>(
      { method: 'POST', url: '/api/facts', payload: { kind: 'experience', body: role } },
      201,
    );
    await ok({
      method: 'PATCH',
      url: `/api/fact-versions/${fact.current.id}`,
      payload: { status: 'confirmed', maySendToModel: true, mayUseInMaterials: true },
    });
    const job = await ok<JobDetail>({
      method: 'POST',
      url: `/api/jobs/${jobs.helsinki}/snapshots`,
    });
    const draft = await ok<Draft>(
      {
        method: 'POST',
        url: `/api/snapshots/${job.snapshot!.id}/drafts`,
        payload: { kind: 'resume' },
      },
      201,
    );
    assert.equal(fill(await formOf(jobs.helsinki!), 'resume').status, 'needs_answer');
    const document = await ok<DraftDocument>({
      method: 'GET',
      url: `/api/drafts/${draft.id}/document`,
    });
    const kept = await call({
      method: 'POST',
      url: `/api/drafts/${draft.id}/pdfs`,
      payload: pdfOf(wrapped(documentPieces(document.blocks))),
      headers: { 'content-type': 'application/pdf' },
    });
    assert.equal(kept.statusCode, 201, kept.body);
    const pdf = kept.json<PdfCheck>().pdf!;
    const resumeFill = fill(await formOf(jobs.helsinki!), 'resume');
    assert.deepEqual(
      [...brief(resumeFill), resumeFill.documentPdfId],
      ['filled', ['Test Person - Resume - Acme - Platform Engineer.pdf'], 'document', pdf.id],
    );
    // A changed name changes the document: the kept PDF is no longer it.
    await ok({
      method: 'PUT',
      url: '/api/profile',
      payload: { ...profile, name: 'Test P. Person' },
    });
    assert.equal(fill(await formOf(jobs.helsinki!), 'resume').status, 'needs_answer');
    await ok({ method: 'PUT', url: '/api/profile', payload: profile });
  });

  test('refusals: no source, a failing board, unknown jobs and questions, files', async () => {
    const pasted = await ok<JobDetail>(
      {
        method: 'POST',
        url: '/api/jobs',
        payload: {
          title: 'Pasted job',
          url: 'https://careers.example.com/jobs/1',
          text: 'Made up.',
        },
      },
      201,
    );
    assert.deepEqual(await formOf(pasted.id), { canRead: false, form: null });
    await refused(
      { method: 'POST', url: `/api/jobs/${pasted.id}/form` },
      409,
      'None of the sources you use can give this job’s application form. The app reads forms from Greenhouse job boards.',
    );
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${pasted.id}/form/answers/email`,
        payload: { answer: ['x'] },
      },
      404,
    );

    boards['acme'] = async () => new Response('Server error', { status: 500 });
    await refused(
      { method: 'POST', url: `/api/jobs/${jobs.stockholm}/form` },
      502,
      'boards-api.greenhouse.io answered HTTP 500.',
    );
    // What the app read before stays.
    assert.notEqual((await formOf(jobs.stockholm!)).form, null);

    await refused({ method: 'GET', url: `/api/jobs/${uuid}/form` }, 404);
    await refused({ method: 'POST', url: `/api/jobs/${uuid}/form` }, 404);
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/nope`,
        payload: { answer: ['x'] },
      },
      404,
    );
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/resume`,
        payload: { answer: ['cv.pdf'] },
      },
      400,
      'The app attaches only the resume and cover letter PDFs you kept.',
    );
    await refused(
      {
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/email`,
        payload: { answer: ['a\nb'] },
      },
      400,
      'This question takes one line.',
    );
    const unsigned = await app.inject({ method: 'GET', url: `/api/jobs/${jobs.helsinki}/form` });
    assert.equal(unsigned.statusCode, 401);
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/answers',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { wordings: ['Q'], answer: ['x'], sensitive: false, places: [] },
    });
    assert.equal(crossSite.statusCode, 403);
  });

  test('database: a kept form keeps its questions, and answers need text', async () => {
    await assert.rejects(pool.query(`update job_form set questions = '[]'`), /is immutable/);
    await assert.rejects(pool.query('delete from job_form'), /cannot be deleted/);
    await pool.query('update job_form set last_captured_at = now()');
    for (const [wordings, answer] of [
      ['{}', '{x}'],
      ['{" "}', '{x}'],
      ['{Q}', '{}'],
      ['{Q}', '{""}'],
    ]) {
      await assert.rejects(
        pool.query('insert into form_answer (wordings, answer, sensitive) values ($1, $2, false)', [
          wordings,
          answer,
        ]),
        { code: '23514' },
      );
    }
    await assert.rejects(
      pool.query(
        `insert into job_form_answer (job_id, question_key, label, answer) values ($1, 'q', 'Q', '{}')`,
        [jobs.helsinki],
      ),
      { code: '23514' },
    );
  });
});
