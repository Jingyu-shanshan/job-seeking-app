import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  ApplicationRecord,
  ApplicationsResponse,
  CreatedRunnerToken,
  Draft,
  DraftDocument,
  Fact,
  FactsResponse,
  FormCheckRequest,
  JobDetail,
  JobFillState,
  JobsResponse,
  PageField,
  PdfCheck,
  RunnerTask,
  RunnerTaskState,
  RunnerToken,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { documentPieces } from '../rules/document.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeDeepSeek } from '../testing/deepseek.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
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

// A 1×1 PNG.
const screenshot =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Lines of at most 60 characters, broken at spaces, as a PDF wraps them. */
const wrapped = (pieces: readonly string[]) =>
  pieces.flatMap((piece) => {
    const lines: string[] = [];
    let line = '';
    for (const word of piece.split(' ')) {
      if (line && line.length + word.length + 1 > 60) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    return [...lines, line];
  });

describe('the local runner', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const greenhouse = fakeGreenhouse({
    acme: [
      { id: 7, title: 'Platform Engineer', location: 'Helsinki, Finland' },
      { id: 8, title: 'Data Engineer', location: 'Espoo, Finland' },
    ],
  });
  const deepseek = fakeDeepSeek(async () => {
    const sent = JSON.parse(deepseek.requests.at(-1)!.body.messages[1]!.content) as {
      facts: { ref: string; text: string }[];
    };
    const ref = sent.facts.find((f) => f.text === role)!.ref;
    const resume = {
      headline: { text: 'Backend developer', facts: [ref] },
      summary: [],
      experience: [{ title: { text: role, facts: [ref] }, bullets: [] }],
    };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(resume) }, finish_reason: 'stop' }],
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

  /** A request of the runner: its token, no cookie, no Origin. */
  const asRunner = (token: string, options: InjectOptions) =>
    app.inject({ ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });

  const runnerState = async (token: string, options: InjectOptions, status = 200) => {
    const res = await asRunner(token, options);
    assert.equal(res.statusCode, status, res.body);
    return res.json<RunnerTaskState>();
  };

  const issue = (name: string) =>
    ok<CreatedRunnerToken>({ method: 'POST', url: '/api/runner-tokens', payload: { name } }, 201);

  const fillState = (jobId: string) =>
    ok<JobFillState>({ method: 'GET', url: `/api/jobs/${jobId}/fill` });
  const start = (jobId: string) =>
    ok<JobFillState>({ method: 'POST', url: `/api/jobs/${jobId}/fill` }, 201);
  const claim = async (token: string) => {
    const res = await asRunner(token, { method: 'POST', url: '/api/runner/tasks/claim' });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<RunnerTask>();
  };
  const check = (token: string, taskId: string, body: Partial<FormCheckRequest>, status = 200) =>
    runnerState(
      token,
      {
        method: 'POST',
        url: `/api/runner/tasks/${taskId}/checks`,
        payload: { filledNow: true, blocker: null, fields: [], screenshot, ...body },
      },
      status,
    );

  const jobs: Record<string, string> = {};
  let token = '';
  let resumePdfId = '';

  test('tokens: issued once, kept only as a hash, revoked', async () => {
    assert.deepEqual(await ok<RunnerToken[]>({ method: 'GET', url: '/api/runner-tokens' }), []);
    const created = await issue('  My   laptop ');
    assert.match(created.token, /^jsa_runner_[A-Za-z0-9_-]{43}$/);
    assert.equal(created.runnerToken.name, 'My laptop');
    assert.equal(created.runnerToken.lastUsedAt, null);
    const stored = await pool.query('select * from runner_token');
    assert.ok(!JSON.stringify(stored.rows).includes(created.token.slice('jsa_runner_'.length)));

    // The runner signs in with the token alone: no cookie and no Origin.
    const reset = await asRunner(created.token, { method: 'POST', url: '/api/runner/reset' });
    assert.equal(reset.statusCode, 204, reset.body);
    const [listed] = await ok<RunnerToken[]>({ method: 'GET', url: '/api/runner-tokens' });
    assert.notEqual(listed!.lastUsedAt, null);

    for (const authorization of [
      undefined,
      'Bearer jsa_runner_short',
      `Basic ${created.token}`,
      `Bearer ${created.token.slice(0, -1)}A`,
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runner/tasks/claim',
        headers: authorization ? { authorization } : {},
      });
      assert.equal(res.statusCode, 401, authorization);
    }
    // The user's session does not open the runner's API, and the token opens nothing else.
    assert.equal((await call({ method: 'POST', url: '/api/runner/tasks/claim' })).statusCode, 401);
    assert.equal(
      (await asRunner(created.token, { method: 'GET', url: '/api/jobs' })).statusCode,
      401,
    );
    // Unknown runner routes need the token too.
    assert.equal((await app.inject({ method: 'GET', url: '/api/runner/nothing' })).statusCode, 401);

    const revoked = await ok<RunnerToken>({
      method: 'DELETE',
      url: `/api/runner-tokens/${created.runnerToken.id}`,
    });
    assert.notEqual(revoked.revokedAt, null);
    await refused({ method: 'DELETE', url: `/api/runner-tokens/${created.runnerToken.id}` }, 404);
    const after = await asRunner(created.token, { method: 'POST', url: '/api/runner/reset' });
    assert.equal(after.statusCode, 401);

    token = (await issue('Runner')).token;
    await refused({ method: 'POST', url: '/api/runner-tokens', payload: { name: ' ' } }, 400);
    const res = await app.inject({
      method: 'POST',
      url: '/api/runner-tokens',
      headers: { cookie },
      payload: { name: 'Cross-site' },
    });
    assert.equal(res.statusCode, 403);
  });

  test('a fill starts only for a Greenhouse job whose required questions are answered', async () => {
    await ok({ method: 'PUT', url: '/api/profile', payload: profile });
    await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'acme' },
    });
    await call({ method: 'POST', url: '/api/discovery-runs', payload: {} });
    const { jobs: found } = await ok<JobsResponse>({ method: 'GET', url: '/api/jobs' });
    jobs.helsinki = found.find((j) => j.title === 'Platform Engineer')!.id;
    jobs.espoo = found.find((j) => j.title === 'Data Engineer')!.id;

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
    assert.deepEqual(await fillState(pasted.id), {
      cannotStart: 'The runner fills only the forms of jobs on a Greenhouse board you use.',
      task: null,
      runnerSeenAt: (await fillState(pasted.id)).runnerSeenAt,
      approval: null,
      application: null,
    });
    assert.equal(
      (await fillState(jobs.helsinki!)).cannotStart,
      'Read the job’s application form first.',
    );
    await refused(
      { method: 'POST', url: `/api/jobs/${jobs.helsinki}/fill` },
      409,
      'Read the job’s application form first.',
    );

    await ok({ method: 'POST', url: `/api/jobs/${jobs.helsinki}/form` });
    assert.equal(
      (await fillState(jobs.helsinki!)).cannotStart,
      'Answer these questions first: “First Name”, “Last Name”, “Resume/CV”, “Will you now or in the future require sponsorship for a visa?”, “What is your notice period?” and 1 more.',
    );
    const answers: [string, string[]][] = [
      ['first_name', ['Test']],
      ['last_name', ['Person']],
      ['question_102', ['No']],
      ['question_103', ['One month']],
      ['gdpr_processing_consent_given', ['yes']],
    ];
    for (const [key, answer] of answers) {
      await ok({
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/${key}`,
        payload: { answer },
      });
    }
    assert.equal(
      (await fillState(jobs.helsinki!)).cannotStart,
      'Answer these questions first: “Resume/CV”.',
    );

    // A resume PDF kept for the job.
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
    resumePdfId = kept.json<PdfCheck>().pdf!.id;

    const ready = await fillState(jobs.helsinki!);
    assert.equal(ready.cannotStart, null);
    assert.equal(ready.task, null);
    const started = await start(jobs.helsinki);
    assert.deepEqual(
      [started.task!.status, started.task!.message, started.task!.check, started.cannotStart],
      [
        'waiting',
        'Waiting for the runner on your computer to take it.',
        null,
        'The runner has this job’s form already. Close that fill to start another.',
      ],
    );
    assert.equal(
      started.task!.url,
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7',
    );
    await refused(
      { method: 'POST', url: `/api/jobs/${jobs.helsinki}/fill` },
      409,
      'The runner has this job’s form already. Close that fill to start another.',
    );
    await refused({ method: 'GET', url: `/api/jobs/${uuid}/fill` }, 404);
    await refused({ method: 'POST', url: `/api/jobs/${uuid}/fill` }, 404);
  });

  test('the runner takes the fill, gets its answers and files, and pauses on problems', async () => {
    const task = await claim(token);
    assert.deepEqual([task.title, task.company], ['Platform Engineer', 'Acme']);
    assert.equal(task.url, 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7');
    assert.deepEqual(
      task.fields.map((f) => [f.key, f.answer, f.source]),
      [
        ['first_name', ['Test'], 'job'],
        ['last_name', ['Person'], 'job'],
        ['email', ['test.person@example.com'], 'profile'],
        ['phone', ['+358 40 000 0000'], 'profile'],
        ['resume', ['Test Person - Resume - Acme - Platform Engineer.pdf'], 'document'],
        ['cover_letter', [], null],
        ['question_101', ['https://www.linkedin.com/in/test-person/'], 'profile'],
        ['question_102', ['No'], 'job'],
        ['question_103', ['One month'], 'job'],
        ['location', ['Helsinki'], 'profile'],
        ['gender', [], null],
        ['gdpr_processing_consent_given', ['Consent given'], 'job'],
      ],
    );
    assert.equal(task.fields.find((f) => f.key === 'resume')!.documentPdfId, resumePdfId);
    // Nothing else is waiting.
    const none = await asRunner(token, { method: 'POST', url: '/api/runner/tasks/claim' });
    assert.equal(none.statusCode, 204);

    assert.deepEqual(
      await runnerState(token, { method: 'GET', url: `/api/runner/tasks/${task.id}` }),
      {
        status: 'filling',
        message: 'The runner has opened the form in a Chrome window on your computer.',
      },
    );
    const file = await asRunner(token, {
      method: 'GET',
      url: `/api/runner/tasks/${task.id}/files/${resumePdfId}`,
    });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.equal(file.rawPayload.subarray(0, 5).toString(), '%PDF-');
    const notAttached = await asRunner(token, {
      method: 'GET',
      url: `/api/runner/tasks/${task.id}/files/${uuid}`,
    });
    assert.equal(notAttached.statusCode, 404);
    // Another runner does not see this fill.
    const other = (await issue('Other')).token;
    const elsewhere = await asRunner(other, { method: 'GET', url: `/api/runner/tasks/${task.id}` });
    assert.equal(elsewhere.statusCode, 404);

    const page: PageField[] = [
      { key: 'first_name', label: 'First Name', required: true, kind: 'text', value: ['Test'] },
      { key: 'last_name', label: 'Last Name', required: true, kind: 'text', value: [] },
      {
        key: 'email',
        label: 'Email',
        required: true,
        kind: 'text',
        value: ['test.person@example.com'],
      },
      { key: 'country', label: 'Country', required: true, kind: 'select', value: [] },
    ];
    const paused = await check(token, task.id, { fields: page });
    assert.equal(paused.status, 'paused');
    assert.match(paused.message, /Required and empty: “Last Name”, “Country”\./);
    assert.match(paused.message, /Not found on the page: “Phone”, “Resume\/CV”/);
    // Only a fill that is being filled takes a look.
    const again = await check(token, task.id, { fields: page }, 409);
    assert.equal(again.status, 'paused');

    const state = await fillState(jobs.helsinki!);
    assert.equal(state.task!.status, 'paused');
    assert.notEqual(state.task!.runnerSeenAt, null);
    assert.notEqual(state.runnerSeenAt, null);
    const shown = state.task!.check!;
    assert.deepEqual(
      shown.fields.slice(0, 4).map((f) => [f.key, f.state]),
      [
        ['first_name', 'as_filled'],
        ['last_name', 'empty'],
        ['email', 'as_filled'],
        ['country', 'left_empty'],
      ],
    );
    const image = await call({ method: 'GET', url: shown.screenshotUrl });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal(image.rawPayload.toString('base64'), screenshot);
    assert.equal(Number((await pool.query('select count(*) from fill_check')).rows[0].count), 1);

    // The user fills the rest in the window and continues: the form is taken as it is.
    const continued = await ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${task.id}/continue`,
    });
    assert.equal(continued.task!.status, 'filling');
    const typed = page.map((f) => (f.value.length ? f : { ...f, value: ['Typed'] }));
    const filled = await check(token, task.id, { fields: typed, filledNow: false });
    assert.equal(filled.status, 'filled');
    assert.match(filled.message, /Some fields are not as the app filled them in/);
    const now = (await fillState(jobs.helsinki!)).task!;
    assert.deepEqual(
      now.check!.fields.slice(0, 4).map((f) => [f.key, f.value, f.state]),
      [
        ['first_name', ['Test'], 'as_filled'],
        ['last_name', ['Typed'], 'changed'],
        ['email', ['test.person@example.com'], 'as_filled'],
        ['country', ['Typed'], 'from_window'],
      ],
    );

    // A CAPTCHA pauses after the user's Continue too.
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/continue` });
    const captcha = await check(token, task.id, { blocker: 'captcha', filledNow: false });
    assert.deepEqual(captcha.status, 'paused');
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/continue` });
    const bad = await asRunner(token, {
      method: 'POST',
      url: `/api/runner/tasks/${task.id}/checks`,
      payload: { filledNow: false, blocker: null, fields: [], screenshot: 'bm90IGEgcG5n' },
    });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json<{ message: string }>().message, /not a PNG/);

    const closed = await ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${task.id}/close`,
    });
    assert.deepEqual(
      [closed.task!.status, closed.task!.message, closed.cannotStart],
      ['closed', 'You closed this fill; the runner closes its window.', null],
    );
    assert.equal(
      (await runnerState(token, { method: 'GET', url: `/api/runner/tasks/${task.id}` })).status,
      'closed',
    );
    assert.equal((await check(token, task.id, {}, 409)).status, 'closed');
    await refused(
      { method: 'POST', url: `/api/fill-tasks/${task.id}/continue` },
      409,
      'This fill is closed, so that cannot be done now.',
    );
    await refused({ method: 'POST', url: `/api/fill-tasks/${uuid}/close` }, 404);
    await refused({ method: 'GET', url: `/api/fill-checks/${uuid}/screenshot` }, 404);
  });

  test('a fill ends when the user closes it, the window closes, the runner fails or stops', async () => {
    const closedWaiting = await start(jobs.helsinki!);
    const closed = await ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${closedWaiting.task!.id}/close`,
    });
    assert.equal(closed.task!.status, 'closed');
    // A closed fill is never taken.
    assert.equal(
      (await asRunner(token, { method: 'POST', url: '/api/runner/tasks/claim' })).statusCode,
      204,
    );

    const end = async (how: InjectOptions['url'], payload?: object) => {
      await start(jobs.helsinki!);
      const task = await claim(token);
      return runnerState(token, {
        method: 'POST',
        url: `/api/runner/tasks/${task.id}/${how}`,
        ...(payload ? { payload } : {}),
      });
    };
    assert.deepEqual(await end('window-closed'), {
      status: 'closed',
      message: 'The browser window was closed.',
    });
    assert.deepEqual(await end('failure', { message: ' The page did not load. ' }), {
      status: 'failed',
      message: 'The runner could not go on: The page did not load.',
    });

    // Stopping or starting again: the runner's open fills have no window any more.
    await start(jobs.helsinki!);
    const filling = await claim(token);
    const reset = await asRunner(token, { method: 'POST', url: '/api/runner/reset' });
    assert.equal(reset.statusCode, 204);
    const failed = (await fillState(jobs.helsinki!)).task!;
    assert.deepEqual(
      [failed.id, failed.status, failed.message],
      [
        filling.id,
        'failed',
        'The runner stopped while it had this form open, so its window is closed.',
      ],
    );
    await start(jobs.helsinki!);
    const filled = await claim(token);
    assert.equal((await check(token, filled.id, { filledNow: false })).status, 'filled');
    await asRunner(token, { method: 'POST', url: '/api/runner/reset' });
    assert.equal((await fillState(jobs.helsinki!)).task!.status, 'closed');

    // Revoking the token ends its fills too.
    await start(jobs.helsinki!);
    const revokedFill = await claim(token);
    const listed = await ok<RunnerToken[]>({ method: 'GET', url: '/api/runner-tokens' });
    const runner = listed.find((t) => t.name === 'Runner')!;
    await ok({ method: 'DELETE', url: `/api/runner-tokens/${runner.id}` });
    const ended = (await fillState(jobs.helsinki!)).task!;
    assert.deepEqual(
      [ended.id, ended.status, ended.message],
      [revokedFill.id, 'failed', 'You revoked the token of the runner that had this form open.'],
    );
  });

  // T18: approving and submitting.

  /** The page with every answer of the fill in it, as the runner reads it. */
  const pageOf = (fields: RunnerTask['fields']): PageField[] =>
    fields.map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      kind: 'text',
      value: f.kind === 'consent' && f.answer.length ? ['checked'] : f.answer,
    }));
  const approve = (taskId: string, checkId: string) =>
    ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${taskId}/approve`,
      payload: { checkId },
    });
  const submit = (runner: string, task: RunnerTask, fields = pageOf(task.fields), blocker = null) =>
    asRunner(runner, {
      method: 'POST',
      url: `/api/runner/tasks/${task.id}/submit`,
      payload: { filledNow: false, blocker, fields, screenshot },
    });
  const result = (runner: string, taskId: string, body: object, status = 200) =>
    runnerState(
      runner,
      {
        method: 'POST',
        url: `/api/runner/tasks/${taskId}/result`,
        payload: {
          confirmation: false,
          pageUrl: null,
          pageText: '',
          note: '',
          screenshot,
          ...body,
        },
      },
      status,
    );
  const confirmationUrl =
    'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=7';
  let submitter = '';

  /** A fill of the Helsinki job, filled with every answer, and its state. */
  const filled = async () => {
    await start(jobs.helsinki!);
    const task = await claim(submitter);
    assert.equal(
      (await check(submitter, task.id, { fields: pageOf(task.fields) })).status,
      'filled',
    );
    return { task, state: await fillState(jobs.helsinki!) };
  };
  /** Approved, and Submit let press. */
  const pressed = async () => {
    const { task, state } = await filled();
    await approve(task.id, state.task!.check!.id);
    const res = await submit(submitter, task);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<RunnerTaskState>().status, 'submitting');
    return task;
  };
  const settle = (applicationId: string, submitted: boolean) =>
    ok<JobFillState>({
      method: 'POST',
      url: `/api/applications/${applicationId}/settle`,
      payload: { submitted },
    });

  test('approval: binds the look the user saw, the job text and the PDFs; it can be withdrawn', async () => {
    submitter = (await issue('Submitter')).token;
    const { task, state } = await filled();
    const snapshot = await pool.query<{ id: string }>(
      'select id from job_snapshot where job_id = $1',
      [jobs.helsinki],
    );
    const pdf = await pool.query<{ body_sha256: string }>(
      'select body_sha256 from document_pdf where id = $1',
      [resumePdfId],
    );
    assert.deepEqual(
      { ...state.approval!, snapshot: state.approval!.snapshot?.id },
      {
        problem: null,
        snapshot: snapshot.rows[0]!.id,
        files: [
          {
            label: 'Resume/CV',
            fileName: 'Test Person - Resume - Acme - Platform Engineer.pdf',
            sha256: pdf.rows[0]!.body_sha256,
          },
        ],
        submittedLastDay: 0,
        dailyCap: 5,
        approvedAt: null,
      },
    );
    assert.equal(state.application, null);

    await refused(
      { method: 'POST', url: `/api/fill-tasks/${task.id}/approve`, payload: { checkId: uuid } },
      409,
      'The runner read the form again since. Look at it as it is now.',
    );
    const approved = await approve(task.id, state.task!.check!.id);
    assert.equal(approved.task!.status, 'approved');
    assert.notEqual(approved.approval!.approvedAt, null);
    assert.equal(
      (await runnerState(submitter, { method: 'GET', url: `/api/runner/tasks/${task.id}` })).status,
      'approved',
    );
    await refused(
      {
        method: 'POST',
        url: `/api/fill-tasks/${task.id}/approve`,
        payload: { checkId: state.task!.check!.id },
      },
      409,
      'This fill is approved for submitting, so it cannot be approved.',
    );
    await refused({ method: 'POST', url: `/api/fill-tasks/${task.id}/continue` }, 409);

    const withdrawn = await ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${task.id}/withdraw`,
    });
    assert.deepEqual(
      [withdrawn.task!.status, withdrawn.task!.message, withdrawn.approval!.approvedAt],
      ['filled', 'You withdrew your approval. Nothing has been sent to the company.', null],
    );
    await refused({ method: 'POST', url: `/api/fill-tasks/${task.id}/withdraw` }, 409);
    // A withdrawn approval is never used: the runner's look before Submit finds none.
    const none = await submit(submitter, task);
    assert.equal(none.statusCode, 409);
    assert.equal(none.json<RunnerTaskState>().status, 'filled');

    // Approved again and closed: nothing is submitted.
    await approve(task.id, state.task!.check!.id);
    const closed = await ok<JobFillState>({
      method: 'POST',
      url: `/api/fill-tasks/${task.id}/close`,
    });
    assert.equal(closed.task!.status, 'closed');
    assert.equal((await submit(submitter, task)).statusCode, 409);
    const approvals = await pool.query(
      'select used_at, withdrawn_at from submit_approval where fill_task_id = $1',
      [task.id],
    );
    assert.equal(approvals.rowCount, 2);
    assert.ok(approvals.rows.every((r) => r.used_at === null && r.withdrawn_at !== null));
    assert.equal(Number((await pool.query('select count(*) from application')).rows[0].count), 0);
  });

  test('a change after approval voids it: answers, documents, the job text, the page', async () => {
    // An answer changes.
    let { task, state } = await filled();
    await approve(task.id, state.task!.check!.id);
    const answer = (value: string) =>
      ok({
        method: 'PUT',
        url: `/api/jobs/${jobs.helsinki}/form/answers/question_103`,
        payload: { answer: [value] },
      });
    await answer('Two months');
    const changed = await fillState(jobs.helsinki!);
    assert.equal(
      changed.approval!.problem,
      'Your answers or documents changed since the runner filled the form: “What is your notice period?”. Close this fill and start another, so the form holds them.',
    );
    let res = await submit(submitter, task);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json<RunnerTaskState>(), {
      status: 'filled',
      message: `The runner did not press Submit. ${changed.approval!.problem}`,
    });
    await answer('One month');
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/close` });

    // The job's text changes: the PDF of the old text is no longer the job's either.
    ({ task, state } = await filled());
    await approve(task.id, state.task!.check!.id);
    const old = state.approval!.snapshot!.id;
    const { rows } = await pool.query<{ id: string }>(
      `insert into job_snapshot (job_id, body, catalog_id, title, company, location, source_url)
       select job_id, body || ' Changed.', catalog_id, title, company, location, source_url
       from job_snapshot where id = $1 returning id`,
      [old],
    );
    res = await submit(submitter, task);
    assert.equal(
      res.json<RunnerTaskState>().message,
      'The runner did not press Submit. The job’s text changed since you approved.',
    );
    await pool.query('update job_snapshot set last_captured_at = now() where id = $1', [old]);
    assert.notEqual(rows[0]!.id, old);
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/close` });

    // The page: a value the user changed in the window after approving, or a CAPTCHA.
    ({ task, state } = await filled());
    await approve(task.id, state.task!.check!.id);
    const typed = pageOf(task.fields).map((f) =>
      f.key === 'email' ? { ...f, value: ['other@example.com'] } : f,
    );
    res = await submit(submitter, task, typed);
    assert.equal(
      res.json<RunnerTaskState>().message,
      'The runner did not press Submit. The form changed after you approved it: “Email”. Look at it again and approve it again if it is right.',
    );
    // That look is the latest: the preview shows it, and approving needs the user to look again.
    assert.equal(
      (await fillState(jobs.helsinki!)).task!.check!.fields.find((f) => f.key === 'email')!.state,
      'changed',
    );
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/continue` });
    await check(submitter, task.id, { fields: pageOf(task.fields), filledNow: false });
    await approve(task.id, (await fillState(jobs.helsinki!)).task!.check!.id);
    res = await asRunner(submitter, {
      method: 'POST',
      url: `/api/runner/tasks/${task.id}/submit`,
      payload: { filledNow: false, blocker: 'captcha', fields: pageOf(task.fields), screenshot },
    });
    assert.equal(res.json<RunnerTaskState>().status, 'paused');
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/close` });

    // The 24 hours are full.
    const others = await pool.query<{ job_id: string; id: string }>(
      `with jobs as (insert into job select from generate_series(1, 5) returning id),
       texts as (
         insert into job_snapshot (job_id, body, catalog_id, title, source_url)
         select id, 'Made up ' || id, 'paste', 'Made up', 'https://example.com/made-up'
         from jobs returning id, job_id
       )
       insert into application (job_id, job_snapshot_id, status, method)
       select job_id, id, 'to_verify', 'runner' from texts
       returning job_id, id`,
    );
    ({ task, state } = await filled());
    assert.equal(
      state.approval!.problem,
      '5 applications went in (or may have) in the last 24 hours, which is the most the app allows (5). Try again later.',
    );
    await refused(
      {
        method: 'POST',
        url: `/api/fill-tasks/${task.id}/approve`,
        payload: { checkId: state.task!.check!.id },
      },
      409,
      state.approval!.problem!,
    );
    await pool.query(`update application set status = 'not_submitted' where id = any($1)`, [
      others.rows.map((r) => r.id),
    ]);
    await ok({ method: 'POST', url: `/api/fill-tasks/${task.id}/close` });
    assert.equal(
      Number(
        (await pool.query(`select count(*) from application where status <> 'not_submitted'`))
          .rows[0].count,
      ),
      0,
    );
  });

  test('to verify: Submit pressed once, then no confirmation, a closed window, a stopped runner', async () => {
    // Two looks at once (a runner repeating itself): only one may press Submit.
    const { task, state } = await filled();
    await approve(task.id, state.task!.check!.id);
    const both = await Promise.all([submit(submitter, task), submit(submitter, task)]);
    assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 409]);
    assert.ok(both.every((r) => r.json<RunnerTaskState>().status === 'submitting'));
    const submitting = await fillState(jobs.helsinki!);
    assert.equal(submitting.task!.status, 'submitting');
    assert.equal(submitting.application!.status, 'to_verify');
    assert.equal(
      submitting.cannotStart,
      'The runner has this job’s form already. Close that fill to start another.',
    );
    await refused({ method: 'POST', url: `/api/fill-tasks/${task.id}/close` }, 409);
    await refused({ method: 'POST', url: `/api/fill-tasks/${task.id}/withdraw` }, 409);
    // Not settled while the runner watches.
    await refused(
      {
        method: 'POST',
        url: `/api/applications/${submitting.application!.id}/settle`,
        payload: { submitted: false },
      },
      409,
    );
    const shows = await runnerState(submitter, {
      method: 'POST',
      url: `/api/runner/tasks/${task.id}/progress`,
      payload: { shows: 'security_code' },
    });
    assert.match(shows.message, /Greenhouse emailed you a security code/);
    // The confirmation page of another job does not count.
    const unclear = await result(submitter, task.id, {
      confirmation: true,
      pageUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme&token=8',
      note: 'Greenhouse’s confirmation page did not show within 10 minutes.',
    });
    assert.deepEqual(unclear, {
      status: 'to_verify',
      message:
        'Submit was pressed, but the runner did not see Greenhouse’s confirmation page. Greenhouse’s confirmation page did not show within 10 minutes. Check your email or the company’s site, then say below whether the application went through. The app never presses Submit again by itself.',
    });
    await result(submitter, task.id, {}, 409);
    const verify = await fillState(jobs.helsinki!);
    assert.equal(verify.application!.status, 'to_verify');
    assert.equal(verify.application!.receipt!.confirmed, false);
    assert.equal(
      verify.cannotStart,
      'The result of this job’s application is unknown. Say below whether it went through first.',
    );
    await refused(
      { method: 'POST', url: `/api/jobs/${jobs.helsinki}/fill` },
      409,
      verify.cannotStart!,
    );
    const receipt = await call({ method: 'GET', url: verify.application!.receipt!.screenshotUrl! });
    assert.equal(receipt.headers['content-type'], 'image/png');
    const notSent = await settle(verify.application!.id, false);
    assert.deepEqual(
      [notSent.application!.status, notSent.application!.submittedAt, notSent.cannotStart],
      ['not_submitted', null, null],
    );
    await refused(
      {
        method: 'POST',
        url: `/api/applications/${verify.application!.id}/settle`,
        payload: { submitted: true },
      },
      409,
    );
    await refused(
      { method: 'POST', url: `/api/applications/${uuid}/settle`, payload: { submitted: true } },
      404,
    );

    // The window closes after Submit.
    const pressedTask = await pressed();
    assert.deepEqual(
      await runnerState(submitter, {
        method: 'POST',
        url: `/api/runner/tasks/${pressedTask.id}/window-closed`,
      }),
      {
        status: 'to_verify',
        message:
          'The browser window was closed after Submit was pressed, before the runner saw the result. Check your email or the company’s site, then say below whether the application went through. The app never presses Submit again by itself.',
      },
    );
    await settle((await fillState(jobs.helsinki!)).application!.id, false);

    // The runner stops (or its token is revoked) after Submit.
    await pressed();
    await asRunner(submitter, { method: 'POST', url: '/api/runner/reset' });
    const stopped = await fillState(jobs.helsinki!);
    assert.equal(stopped.task!.status, 'to_verify');
    assert.match(stopped.task!.message, /^The runner stopped after it pressed Submit/);
    assert.equal(stopped.application!.receipt, null);
    await settle(stopped.application!.id, false);
    assert.equal(
      Number(
        (await pool.query('select count(*) from application where job_id = $1', [jobs.helsinki]))
          .rows[0].count,
      ),
      3,
    );
  });

  test('submitted: Greenhouse’s confirmation page after the one Submit', async () => {
    const task = await pressed();
    const done = await result(submitter, task.id, {
      confirmation: true,
      pageUrl: confirmationUrl,
      pageText: 'Thank you for applying to Acme!',
    });
    assert.deepEqual(done, {
      status: 'submitted',
      message: 'Greenhouse showed its confirmation page: the application went in.',
    });
    const state = await fillState(jobs.helsinki!);
    const application = state.application!;
    assert.equal(application.status, 'submitted');
    assert.equal(application.submittedAt, application.createdAt);
    assert.deepEqual(
      { ...application.receipt!, checkedAt: null, screenshotUrl: null },
      {
        confirmed: true,
        pageUrl: confirmationUrl,
        pageText: 'Thank you for applying to Acme!',
        note: '',
        checkedAt: null,
        screenshotUrl: null,
      },
    );
    assert.equal(state.approval, null);
    assert.equal(state.cannotStart, 'This job’s application went in already.');
    await refused(
      { method: 'POST', url: `/api/jobs/${jobs.helsinki}/fill` },
      409,
      state.cannotStart!,
    );
    await refused(
      {
        method: 'POST',
        url: `/api/applications/${application.id}/settle`,
        payload: { submitted: false },
      },
      409,
    );
    // The approval was used once, by this application.
    const { rows } = await pool.query(
      `select a.status, s.used_at is not null as used from application a
       join submit_approval s on s.id = a.submit_approval_id where a.id = $1`,
      [application.id],
    );
    assert.deepEqual(rows, [{ status: 'submitted', used: true }]);

    // T09: the record keeps the job text, the resume PDF and the fact version it cites, and the
    // form's values as approved; editing the fact afterwards changes none of it.
    const record = await ok<ApplicationRecord>({
      method: 'GET',
      url: `/api/applications/${application.id}`,
    });
    assert.deepEqual(
      [record.method, record.status, record.title, record.match, record.note],
      ['runner', 'submitted', 'Platform Engineer', null, ''],
    );
    const [file] = record.files;
    assert.equal(record.files.length, 1);
    assert.deepEqual([file!.label, file!.draft?.kind], ['Resume/CV', 'resume']);
    assert.match(file!.fileName, /^Test Person - Resume.*\.pdf$/);
    const kept = await pool.query('select body_sha256 from document_pdf where id = $1', [
      resumePdfId,
    ]);
    assert.equal(file!.sha256, kept.rows[0].body_sha256);
    const download = await call({ method: 'GET', url: file!.url });
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.match(String(download.headers['content-disposition']), /Test Person - Resume/);
    assert.deepEqual(
      record.facts.map((f) => [f.text, f.version, f.stillCurrent]),
      [[role, 1, true]],
    );
    assert.ok(record.form!.fields.some((f) => f.label === 'First Name' && f.value[0] === 'Test'));
    assert.equal(record.receipt!.pageText, 'Thank you for applying to Acme!');
    assert.match(record.job.text, /\S/);

    const {
      facts: [fact],
    } = await ok<FactsResponse>({ method: 'GET', url: '/api/facts' });
    await ok(
      {
        method: 'POST',
        url: `/api/facts/${fact!.id}/versions`,
        payload: { body: `${role}, team lead` },
      },
      201,
    );
    const later = await ok<ApplicationRecord>({
      method: 'GET',
      url: `/api/applications/${application.id}`,
    });
    assert.deepEqual(
      later.facts.map((f) => [f.text, f.version, f.stillCurrent]),
      [[role, 1, false]],
    );
    assert.deepEqual(later.files, record.files);

    // Applied counts once in the list, and runs that did not go through are listed as such.
    const { jobs: listed } = await ok<JobsResponse>({ method: 'GET', url: '/api/jobs' });
    assert.equal(listed.find((j) => j.id === jobs.helsinki)!.application, 'submitted');
    assert.equal(listed.find((j) => j.id === jobs.espoo)!.application, null);
    const { applications } = await ok<ApplicationsResponse>({
      method: 'GET',
      url: '/api/applications',
    });
    assert.deepEqual(
      applications.filter((a) => a.jobId === jobs.helsinki).map((a) => a.status),
      ['submitted', 'not_submitted', 'not_submitted', 'not_submitted'],
    );
  });

  test('refusals: no session, no Origin', async () => {
    const noSession = await app.inject({ method: 'GET', url: `/api/jobs/${jobs.helsinki}/fill` });
    assert.equal(noSession.statusCode, 401);
    const crossSite = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobs.espoo}/fill`,
      headers: { cookie },
    });
    assert.equal(crossSite.statusCode, 403);
  });

  test('database: a fill keeps its answers, a look and a token never change, one open fill per job', async () => {
    await assert.rejects(pool.query(`update fill_task set fields = '[]'`), /is immutable/);
    await assert.rejects(
      pool.query(`update fill_task set url = 'https://example.com'`),
      /is immutable/,
    );
    await assert.rejects(pool.query('delete from fill_task'), /cannot be deleted/);
    await assert.rejects(pool.query('update fill_check set filled_now = true'), /is immutable/);
    await assert.rejects(pool.query('delete from fill_check'), /cannot be deleted/);
    await assert.rejects(pool.query(`update runner_token set name = 'x'`), /is immutable/);
    await assert.rejects(
      pool.query(`update runner_token set token_sha256 = sha256('x'::bytea)`),
      /is immutable/,
    );
    const { rows } = await pool.query<{ job_id: string; job_form_id: string }>(
      'select job_id, job_form_id from fill_task limit 1',
    );
    const insert = (status: string) =>
      pool.query(
        `insert into fill_task (job_id, job_form_id, url, fields, status) values ($1, $2, 'https://example.com', '[]', $3)`,
        [rows[0]!.job_id, rows[0]!.job_form_id, status],
      );
    await insert('waiting');
    await assert.rejects(insert('waiting'), /fill_task_open/);
    // A fill a runner works on names the runner.
    await assert.rejects(insert('filling'), /check constraint/);
    await assert.rejects(
      pool.query(
        `insert into fill_task (job_id, job_form_id, url, fields) values ($1, $2, 'http://example.com', '[]')`,
        [rows[0]!.job_id, rows[0]!.job_form_id],
      ),
      /check constraint/,
    );

    // T18: an approval, an application and a receipt keep what they recorded; one application
    // that went in (or may have) per job, and one per approval.
    await assert.rejects(
      pool.query(`update submit_approval set created_at = now() - interval '1 day'`),
      /is immutable/,
    );
    await assert.rejects(pool.query('delete from submit_approval'), /cannot be deleted/);
    await assert.rejects(
      pool.query(`update application set created_at = now() - interval '1 day'`),
      /is immutable/,
    );
    await assert.rejects(pool.query('delete from application'), /cannot be deleted/);
    await assert.rejects(pool.query(`update submit_receipt set note = 'x'`), /is immutable/);
    const sent = await pool.query<{
      job_id: string;
      job_snapshot_id: string;
      submit_approval_id: string;
    }>(
      `select job_id, job_snapshot_id, submit_approval_id from application where status = 'submitted'`,
    );
    const { job_id, job_snapshot_id, submit_approval_id } = sent.rows[0]!;
    await assert.rejects(
      pool.query(
        `insert into application (job_id, job_snapshot_id, status, method) values ($1, $2, 'to_verify', 'runner')`,
        [job_id, job_snapshot_id],
      ),
      /application_job_open/,
    );
    await assert.rejects(
      pool.query(
        `insert into application (job_id, job_snapshot_id, submit_approval_id, status, method) values ($1, $2, $3, 'not_submitted', 'runner')`,
        [job_id, job_snapshot_id, submit_approval_id],
      ),
      /application_submit_approval_id_key/,
    );
  });
});
