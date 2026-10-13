import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { InterviewAnswer, InterviewState } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { fakeDeepSeek, chatCompletion } from '../testing/deepseek.ts';
import { pdfOf } from '../testing/pdf.ts';
import { exportArchive } from '../export/export.ts';
import { unzip } from '../testing/zip.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const answer: InterviewAnswer = {
  technical: [{ text: 'How would you design the API?', sources: ['J1'] }],
  projects: [{ text: 'What tradeoffs did you make?', sources: ['M1'] }],
  stories: [
    {
      title: 'API project',
      situation: null,
      task: null,
      action: 'Built an API',
      result: null,
      missing: ['What was your own responsibility?', 'What changed?'],
      sources: ['M1'],
    },
  ],
  interviewer: [{ text: 'What does success look like?', sources: ['J1'] }],
};

describe('interview preparation', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let response: unknown = answer;
  let waiting: Promise<void> | undefined;
  let entered: (() => void) | undefined;
  const model = fakeDeepSeek(async () => {
    entered?.();
    if (waiting) await waiting;
    return chatCompletion(JSON.stringify(response));
  });
  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      webRoot: join(tmpdir(), 'jsa-no-web'),
      fetch: model.fetch,
      deepseekApiKey: 'sk-test',
    });
    await createAccount(
      { pool, secret, appUrl, trustedOrigins },
      { email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' },
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'owner@example.com', password: 'correct horse battery' },
    });
    cookie = [login.headers['set-cookie'] ?? []]
      .flat()
      .find((c) => c.startsWith('better-auth.session_token='))!
      .split(';')[0]!;
    await call({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        name: 'Test Person',
        email: 'private@example.com',
        phone: '',
        location: '',
        links: [],
      },
    });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });
  const call = (o: InjectOptions) =>
    app.inject({ ...o, headers: { cookie, origin: appUrl, ...o.headers } });
  const row = async (sql: string, values: unknown[] = []) =>
    (await pool.query(sql, values)).rows[0]!;
  const url = (id: string) => `/api/applications/${id}/interview`;
  const generate = (
    id: string,
    payload = { excerpts: [] as { fileId: string; text: string }[], allowExcerpts: false },
  ) => call({ method: 'POST', url: url(id), payload });
  const state = async (id: string) => {
    const r = await call({ method: 'GET', url: url(id) });
    assert.equal(r.statusCode, 200, r.body);
    return r.json<InterviewState>();
  };

  async function seed({ external = false, status = 'submitted', allowed = true } = {}) {
    const job = await row('insert into job default values returning id');
    const snapshot = await row(
      `insert into job_snapshot (job_id, body, catalog_id, title, source_url)
      values ($1, 'Build payment APIs.', 'paste', 'Backend engineer', 'https://example.com/jobs/1') returning id`,
      [job.id],
    );
    const application = await row(
      `insert into application (job_id, job_snapshot_id, status, submitted_at, method)
      values ($1, $2, $3, case when $3 = 'submitted' then now() else null end, 'runner') returning id`,
      [job.id, snapshot.id, status],
    );
    if (external) {
      const file = await row(
        `insert into application_file (application_id, position, label, file_name, body)
        values ($1, 0, '', 'Test Person Resume.pdf', $2) returning id`,
        [application.id, pdfOf(['Test Person', 'private@example.com', 'Built an API'])],
      );
      return {
        id: application.id as string,
        fileId: file.id as string,
        snapshotId: snapshot.id,
        factId: '',
        versionId: '',
        claimId: '',
      };
    }
    const fact = await row("insert into fact (kind) values ('experience') returning id");
    const version = await row(
      `insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
      values ($1, 1, 'Built an API', 'manual', 'confirmed', $2, true) returning id`,
      [fact.id, allowed],
    );
    const call = await row(
      `insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms)
      values ('draft', $1, 'fake', now(), 1) returning id`,
      [snapshot.id],
    );
    const artifact = await row(
      "insert into artifact (job_snapshot_id, kind, model_call_id) values ($1, 'resume', $2) returning id",
      [snapshot.id, call.id],
    );
    await pool.query('insert into artifact_fact values ($1, $2)', [artifact.id, version.id]);
    const claim = await row(
      `insert into artifact_claim (artifact_id, position, body, section, block, line, about)
      values ($1, 0, 'Original draft wording', 'experience', 0, 'bullet', 'me') returning id`,
      [artifact.id],
    );
    await pool.query('insert into artifact_claim_fact values ($1, $2, $3)', [
      claim.id,
      version.id,
      artifact.id,
    ]);
    const edit = await row(
      "insert into artifact_claim_edit (artifact_id, artifact_claim_id, body, included) select artifact_id, id, 'Built an API', true from artifact_claim where id = $1 returning id",
      [claim.id],
    );
    const pdf = await row(
      `insert into document_pdf (artifact_id, body, file_name, pages, text)
      values ($1, $2, 'Test Person Resume', 1, 'Test Person\nBuilt an API') returning id`,
      [artifact.id, pdfOf(['Test Person', 'Built an API'])],
    );
    await pool.query('insert into document_pdf_statement values ($1, $2, $3, $4)', [
      pdf.id,
      artifact.id,
      claim.id,
      edit.id,
    ]);
    const file = await row(
      `insert into application_file (application_id, position, label, file_name, document_pdf_id)
      values ($1, 0, 'Resume', 'Test Person Resume.pdf', $2) returning id`,
      [application.id, pdf.id],
    );
    return {
      id: application.id as string,
      fileId: file.id as string,
      snapshotId: snapshot.id,
      factId: fact.id,
      versionId: version.id,
      claimId: claim.id,
    };
  }

  test('uses frozen PDF edits, old JD and old cited versions; saves practice and private notes only', async () => {
    const s = await seed();
    await pool.query(
      "insert into artifact_claim_edit (artifact_id, artifact_claim_id, body, included) select artifact_id, id, 'Later draft wording', true from artifact_claim where id = $1",
      [s.claimId],
    );
    await pool.query(
      `insert into fact_version (fact_id, version, body, source, status, may_send_to_model, may_use_in_materials)
      values ($1, 2, 'Later fact wording', 'manual', 'confirmed', true, true)`,
      [s.factId],
    );
    await pool.query(
      `insert into job_snapshot (job_id, body, catalog_id, title, source_url)
      select job_id, 'New JD text', 'paste', 'New role', 'https://example.com/new' from job_snapshot where id = $1`,
      [s.snapshotId],
    );
    const result = await generate(s.id);
    assert.equal(result.statusCode, 201, result.body);
    const prep = result.json<InterviewState>().preparation!;
    const sent = model.requests.at(-1)!.body.messages[1]!.content;
    assert.match(sent, /Built an API/);
    assert.match(sent, /Build payment APIs/);
    for (const forbidden of [
      'Original draft',
      'Later draft',
      'Later fact',
      'New JD',
      'Test Person',
      'private@example.com',
      s.versionId,
      s.fileId,
    ])
      assert.ok(!sent.includes(forbidden), forbidden);
    assert.equal(prep.sources[1]!.fileId, s.fileId);
    assert.deepEqual(prep.sources[1]!.factVersionIds, [s.versionId]);
    assert.equal(prep.answer.stories[0]!.result, null);
    const factsBefore = await row('select count(*)::int as n from fact_version');
    const saved = await call({
      method: 'PUT',
      url: `${url(s.id)}/notes`,
      payload: { notes: 'Draft: I led 20 people. To confirm.' },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await state(s.id)).preparation!.notes, 'Draft: I led 20 people. To confirm.');
    assert.deepEqual(await row('select count(*)::int as n from fact_version'), factsBefore);
    assert.deepEqual((await state(s.id)).preparation!.sources, prep.sources);
    await assert.rejects(
      pool.query("update interview_preparation set answer = '{}' where id = $1", [prep.id]),
      /immutable/,
    );
    const before = model.requests.length;
    assert.equal((await generate(s.id)).statusCode, 409);
    assert.equal(model.requests.length, before);
    const zip = unzip(await exportArchive(pool));
    const data = JSON.parse(zip.get('data.json')!.toString());
    assert.ok(data.interview_preparation.some((p: { id: string }) => p.id === prep.id));
    assert.ok(data.interview_notes.some((n: { body: string }) => n.body.includes('20 people')));
  });

  test('requires submitted status, shareable material, and current permission without sending newer facts', async () => {
    const before = model.requests.length;
    for (const status of ['to_verify', 'not_submitted']) {
      const s = await seed({ status });
      assert.ok((await state(s.id)).cannotGenerate);
      assert.equal((await generate(s.id)).statusCode, 409);
    }
    const s = await seed({ allowed: false });
    assert.equal((await state(s.id)).omittedStatements, 1);
    assert.equal((await generate(s.id)).statusCode, 409);
    const revoked = await seed();
    await pool.query(
      `insert into fact_version (fact_id, version, body, source, status, may_send_to_model)
      values ($1, 2, 'New private text', 'manual', 'confirmed', false)`,
      [revoked.factId],
    );
    assert.equal((await state(revoked.id)).sources.length, 1);
    assert.equal((await generate(revoked.id)).statusCode, 409);
    assert.equal(model.requests.length, before);
  });

  test('uploaded PDFs require explicit excerpt permission and a genuine passage; private text is refused', async () => {
    const s = await seed({ external: true });
    const file = (await state(s.id)).externalFiles[0]!;
    assert.match(file.text, /Test Person/);
    const before = model.requests.length;
    for (const payload of [
      { excerpts: [{ fileId: s.fileId, text: 'Built an API' }], allowExcerpts: false },
      { excerpts: [{ fileId: s.fileId, text: 'Invented an API' }], allowExcerpts: true },
      { excerpts: [{ fileId: s.fileId, text: 'Test Person' }], allowExcerpts: true },
      { excerpts: [{ fileId: s.fileId, text: 'private@example.com' }], allowExcerpts: true },
      { excerpts: [{ fileId: s.id, text: 'Built an API' }], allowExcerpts: true },
    ])
      assert.equal((await generate(s.id, payload)).statusCode, 400);
    assert.equal(model.requests.length, before);
    const result = await generate(s.id, {
      excerpts: [{ fileId: s.fileId, text: 'Built an API' }],
      allowExcerpts: true,
    });
    assert.equal(result.statusCode, 201, result.body);
    const sent = model.requests.at(-1)!.body.messages[1]!.content;
    assert.match(sent, /Built an API/);
    assert.ok(!sent.includes('Test Person'));
    assert.ok(!sent.includes('private@example.com'));
    assert.deepEqual(result.json<InterviewState>().preparation!.sources[1]!.factVersionIds, []);
  });

  test('invalid model citations record paid failure, do not save preparation, and permit a retry', async () => {
    const s = await seed();
    response = { ...answer, projects: [{ text: 'Invented role', sources: ['M99'] }] };
    assert.equal((await generate(s.id)).statusCode, 502);
    assert.equal((await state(s.id)).preparation, null);
    const failed = await row(
      "select * from model_call where purpose = 'interview' and job_snapshot_id = $1",
      [s.snapshotId],
    );
    assert.ok(failed.failure_reason);
    assert.ok(Number(failed.cost_usd) > 0);
    response = answer;
    assert.equal((await generate(s.id)).statusCode, 201);
  });

  test('refuses simultaneous generation before a second paid request', async () => {
    const s = await seed();
    let release!: () => void;
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begun = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = generate(s.id);
    await begun;
    const second = await generate(s.id);
    assert.equal(second.statusCode, 409, second.body);
    release();
    waiting = undefined;
    entered = undefined;
    assert.equal((await first).statusCode, 201);
  });

  test('session, Origin, parameter and notes size checks protect the new routes', async () => {
    const s = await seed();
    assert.equal((await app.inject({ method: 'GET', url: url(s.id) })).statusCode, 401);
    assert.equal(
      (
        await call({
          method: 'POST',
          url: url(s.id),
          headers: { origin: 'https://other.example' },
          payload: { excerpts: [], allowExcerpts: false },
        })
      ).statusCode,
      403,
    );
    assert.equal((await call({ method: 'GET', url: url('invalid') })).statusCode, 400);
    assert.equal((await state(s.id)).preparation, null);
    assert.equal(
      (await call({ method: 'PUT', url: `${url(s.id)}/notes`, payload: { notes: 'Unprepared' } }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await call({
          method: 'PUT',
          url: `${url(s.id)}/notes`,
          payload: { notes: 'x'.repeat(12001) },
        })
      ).statusCode,
      400,
    );
  });
});
