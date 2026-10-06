import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Draft, DraftStatement, Fact, FactKind, JobDetail } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
import { coverLetterSystemPrompt, resumeSystemPrompt } from './write.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = {
  email: 'owner@example.com',
  name: 'Owner Person',
  password: 'correct horse battery',
};
const uuid = '00000000-0000-4000-8000-000000000000';

const jobText = `Payments Engineer, Example Pay

You will build the APIs that move money for 40,000 merchants.

What you bring
- 3+ years of Go
- Kubernetes in production

We work in English in Helsinki.`;

const facts = {
  role: 'Backend developer at Acme Oy, 2021-03 – 2024-06',
  result: 'Built the invoice API in Go; cut processing time by about 30%',
  skills: 'Go, PostgreSQL, Kafka',
  finnish: 'Finnish: basic (A2)',
};

interface SentDraft {
  job: { title: string; company: string | null; text: string };
  facts: { ref: string; category: string; text: string }[];
}

type Write = (sent: SentDraft) => unknown;

/** The ref of the fact sent whose text includes `words`. */
const ref = (sent: SentDraft, words: string) =>
  sent.facts.find((f) => f.text.includes(words))?.ref ?? 'F404';

// Three statements pass; the others each break one rule.
const resume: Write = (sent) => ({
  headline: { text: 'Backend developer', facts: [ref(sent, 'Acme')] },
  summary: [
    {
      text: 'Backend developer who built an invoice API in Go and cut its processing time by about 30%.',
      facts: [ref(sent, 'Acme'), ref(sent, 'invoice')],
    },
  ],
  experience: [
    {
      title: { text: 'Backend developer, Acme Oy, 2021-03 – 2024-06', facts: [ref(sent, 'Acme')] },
      bullets: [
        { text: facts.result, facts: [ref(sent, 'invoice')] },
        { text: 'Cut processing time by 45%.', facts: [ref(sent, 'invoice')] },
        { text: 'Led the platform team.', facts: [] },
        { text: 'Ran Kubernetes clusters.', facts: ['F99'] },
        { text: 'Built the invoice API in Go on Kubernetes.', facts: [ref(sent, 'invoice')] },
      ],
    },
  ],
  skills: [{ title: { text: 'Go, PostgreSQL, Kafka', facts: [ref(sent, 'Kafka')] }, bullets: [] }],
  languages: [{ title: { text: 'Finnish', facts: [ref(sent, 'Finnish')] }, bullets: [] }],
});

const coverLetter: Write = (sent) => ({
  paragraphs: [
    [
      { about: 'other', text: 'I am applying for the Payments Engineer role at Example Pay.' },
      {
        about: 'job',
        text: 'You are building the APIs that move money for 40,000 merchants.',
        quote: 'You will build the APIs that move money for 40,000 merchants.',
      },
      { about: 'job', text: 'You serve 50,000 merchants.', quote: 'We serve 50,000 merchants.' },
    ],
    [
      {
        about: 'me',
        text: 'At Acme Oy I built the invoice API in Go and cut its processing time by about 30%.',
        facts: [ref(sent, 'Acme'), ref(sent, 'invoice')],
      },
      { about: 'other', text: 'I have wanted to work in payments for 10 years.' },
    ],
  ],
});

const codesOf = (draft: Draft) =>
  draft.statements.map((s: DraftStatement) => [s.text, s.problems.map((p) => p.code)]);

describe('drafts', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let write: Record<string, Write> = {};
  const normally = async () => {
    const sent = deepseek.requests.at(-1)!;
    const system = sent.body.messages[0]!.content;
    const decide = system === resumeSystemPrompt ? write.resume : write.coverLetter;
    return chatCompletion(JSON.stringify(decide!(JSON.parse(sent.body.messages[1]!.content))));
  };
  let answer: () => Promise<Response> = normally;
  const deepseek = fakeDeepSeek(() => answer());

  const options = () => ({
    webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
    databaseUrl: db.url,
    authSecret: secret,
    appUrl,
    trustedOrigins,
    fetch: deepseek.fetch,
  });

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({ ...options(), deepseekApiKey: 'sk-test' });
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

  beforeEach(() => {
    write = { resume, coverLetter };
    answer = normally;
  });

  const call = (options: InjectOptions, on = app) =>
    on.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const detail = async (jobId: string) => {
    const res = await call({ method: 'GET', url: `/api/jobs/${jobId}` });
    assert.equal(res.statusCode, 200);
    return res.json<JobDetail>();
  };

  let pasted = 0;
  const paste = async () => {
    const res = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        title: 'Payments Engineer',
        company: 'Example Pay',
        location: 'Helsinki',
        url: 'https://careers.example.com/jobs/1',
        text: `${jobText}\nJob ${++pasted}.`,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json<JobDetail>();
  };

  const draft = (snapshotId: string, kind = 'resume', on = app) =>
    call({ method: 'POST', url: `/api/snapshots/${snapshotId}/drafts`, payload: { kind } }, on);

  const read = async (id: string) => {
    const res = await call({ method: 'GET', url: `/api/drafts/${id}` });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<Draft>();
  };

  const addFact = async (
    kind: FactKind,
    body: string,
    change: { status?: string; maySendToModel?: boolean; mayUseInMaterials?: boolean } = {
      status: 'confirmed',
      maySendToModel: true,
      mayUseInMaterials: true,
    },
  ) => {
    const res = await call({ method: 'POST', url: '/api/facts', payload: { kind, body } });
    assert.equal(res.statusCode, 201, res.body);
    const fact = res.json<Fact>();
    if (Object.keys(change).length === 0) return fact;
    const updated = await call({
      method: 'PATCH',
      url: `/api/fact-versions/${fact.current.id}`,
      payload: change,
    });
    assert.equal(updated.statusCode, 200, updated.body);
    return updated.json<Fact>();
  };

  const count = async (from: string, values: unknown[] = []) =>
    Number((await pool.query(`select count(*) from ${from}`, values)).rows[0].count);

  let job: JobDetail;
  let snapshotId: string;
  let result: Fact;

  test('needs facts that may go both to DeepSeek and into documents', async () => {
    job = await paste();
    snapshotId = job.snapshot!.id;
    assert.equal(job.factsToDraft, 0);
    assert.deepEqual(job.snapshot!.drafts, []);

    // Each of these is kept back for one reason.
    await addFact('experience', 'Led the platform team.', {});
    await addFact('statement', 'Holds a residence permit for Finland.', {
      status: 'confirmed',
      mayUseInMaterials: true,
    });
    await addFact('skill', 'A weekend course on Kubernetes.', {
      status: 'confirmed',
      maySendToModel: true,
    });
    await addFact('statement', 'Write to someone@example.com.', {
      status: 'confirmed',
      mayUseInMaterials: true,
    });
    const none = await draft(snapshotId);
    assert.equal(none.statusCode, 409);
    assert.match(none.json().message, /None of your facts may be used in a draft/);
    assert.equal(deepseek.requests.length, 0);

    await addFact('experience', facts.role);
    result = await addFact('experience', facts.result);
    await addFact('skill', facts.skills);
    await addFact('language', facts.finnish);
    assert.equal((await detail(job.id)).factsToDraft, 4);

    const withoutKey = buildApp(options());
    try {
      assert.equal((await draft(snapshotId, 'resume', withoutKey)).statusCode, 503);
    } finally {
      await withoutKey.close();
    }
    assert.equal((await draft(uuid)).statusCode, 404);
    assert.equal((await draft(snapshotId, 'portfolio')).statusCode, 400);
    assert.equal(deepseek.requests.length, 0);
  });

  test('writes a resume from the job text and the facts allowed, nothing else', async () => {
    const res = await draft(snapshotId);
    assert.equal(res.statusCode, 201, res.body);
    const written = res.json<Draft>();

    assert.equal(deepseek.requests.length, 1);
    const sent = deepseek.requests[0]!;
    assert.equal(sent.body.messages[0]!.content, resumeSystemPrompt);
    const request = JSON.parse(sent.body.messages[1]!.content) as SentDraft;
    assert.deepEqual(request.job, {
      title: 'Payments Engineer',
      company: 'Example Pay',
      text: `${jobText}\nJob 1.`,
    });
    assert.deepEqual(
      request.facts.map((f) => [f.ref, f.category, f.text]),
      [
        ['F1', 'experience', facts.role],
        ['F2', 'experience', facts.result],
        ['F3', 'skill', facts.skills],
        ['F4', 'language', facts.finnish],
      ],
    );
    const body = JSON.stringify(sent.body);
    for (const kept of [
      'platform team',
      'residence permit',
      'weekend course',
      '@',
      'Owner Person',
    ]) {
      assert.ok(!body.includes(kept), kept);
    }

    assert.equal(written.kind, 'resume');
    assert.equal(written.jobId, job.id);
    assert.equal(written.factsSent, 4);
    assert.deepEqual(written.outdated, []);
    assert.deepEqual(codesOf(written), [
      ['Backend developer', []],
      [
        'Backend developer who built an invoice API in Go and cut its processing time by about 30%.',
        [],
      ],
      ['Backend developer, Acme Oy, 2021-03 – 2024-06', []],
      [facts.result, []],
      ['Cut processing time by 45%.', ['number']],
      ['Led the platform team.', ['uncited']],
      ['Ran Kubernetes clusters.', ['unsent_fact']],
      ['Built the invoice API in Go on Kubernetes.', ['term']],
      ['Go, PostgreSQL, Kafka', []],
      ['Finnish', ['status', 'status']],
    ]);
    const [, summary, title, verbatim] = written.statements;
    assert.deepEqual(
      [summary!.section, title!.section, title!.line, verbatim!.line, verbatim!.verbatim],
      ['summary', 'experience', 'title', 'bullet', true],
    );
    assert.equal(summary!.verbatim, false);
    assert.deepEqual(
      summary!.facts.map((f) => [f.body, f.version, f.current]).sort(),
      [
        [facts.result, 1, true],
        [facts.role, 1, true],
      ].sort(),
    );

    assert.deepEqual(await read(written.id), written);
    const [listed] = (await detail(job.id)).snapshot!.drafts;
    assert.deepEqual(listed, {
      id: written.id,
      kind: 'resume',
      createdAt: written.createdAt,
      statements: 10,
      rejected: 5,
      outdated: [],
      pdfs: 0,
    });
    assert.equal(
      (
        await pool.query(
          `select purpose from model_call where id = (select model_call_id from artifact where id = $1)`,
          [written.id],
        )
      ).rows[0].purpose,
      'draft',
    );
  });

  test('refuses to write the same draft again from the same facts', async () => {
    const again = await draft(snapshotId);
    assert.equal(again.statusCode, 409);
    assert.match(again.json().message, /already has a resume draft/);
    assert.equal(deepseek.requests.length, 1);
  });

  test('writes a cover letter of statements about the user, the job and neither', async () => {
    const res = await draft(snapshotId, 'cover_letter');
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(deepseek.requests.at(-1)!.body.messages[0]!.content, coverLetterSystemPrompt);
    const letter = res.json<Draft>();
    assert.deepEqual(codesOf(letter), [
      ['I am applying for the Payments Engineer role at Example Pay.', []],
      ['You are building the APIs that move money for 40,000 merchants.', []],
      ['You serve 50,000 merchants.', ['quote_not_found']],
      ['At Acme Oy I built the invoice API in Go and cut its processing time by about 30%.', []],
      ['I have wanted to work in payments for 10 years.', ['number']],
    ]);
    assert.deepEqual(
      letter.statements.map((s) => [s.block, s.about, s.quote !== null]),
      [
        [0, 'other', false],
        [0, 'job', true],
        [0, 'job', true],
        [1, 'me', false],
        [1, 'other', false],
      ],
    );
    assert.deepEqual(
      (await detail(job.id)).snapshot!.drafts.map((d) => [d.kind, d.rejected]),
      [
        ['resume', 5],
        ['cover_letter', 2],
      ],
    );
  });

  test('a fact that changes takes its statements out until the draft is written again', async () => {
    const [resumeId] = (await detail(job.id)).snapshot!.drafts.map((d) => d.id);
    const edited = await call({
      method: 'POST',
      url: `/api/facts/${result.id}/versions`,
      payload: { body: 'Built the invoice API in Go; cut processing time by about a third' },
    });
    assert.equal(edited.statusCode, 201, edited.body);

    const old = await read(resumeId!);
    assert.deepEqual(old.outdated, ['The facts that may be used in drafts have changed since.']);
    const changed = old.statements.filter((s) => s.problems.some((p) => p.code === 'fact_changed'));
    assert.deepEqual(
      changed.map((s) => s.text),
      [
        'Backend developer who built an invoice API in Go and cut its processing time by about 30%.',
        facts.result,
        'Cut processing time by 45%.',
        'Built the invoice API in Go on Kubernetes.',
      ],
    );
    assert.ok(changed[1]!.facts.every((f) => !f.current));
    assert.equal((await detail(job.id)).snapshot!.drafts[0]!.rejected, 7);
    assert.equal((await detail(job.id)).factsToDraft, 3);

    // Writing again sends the facts as they are now, and keeps the old draft.
    const again = await draft(snapshotId);
    assert.equal(again.statusCode, 201, again.body);
    const request = JSON.parse(deepseek.requests.at(-1)!.body.messages[1]!.content) as SentDraft;
    assert.equal(request.facts.length, 3);
    const [latest] = (await detail(job.id)).snapshot!.drafts;
    assert.notEqual(latest!.id, resumeId);
    assert.deepEqual(latest!.outdated, []);
    assert.equal((await read(resumeId!)).statements.length, 10);
  });

  test('a newer job text makes the drafts of the old one out of date', async () => {
    const [resumeDraft] = (await detail(job.id)).snapshot!.drafts;
    const res = await call({
      method: 'POST',
      url: `/api/jobs/${job.id}/text`,
      payload: { text: `${jobText}\nUpdated.` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json<JobDetail>().snapshot!.drafts, []);
    assert.deepEqual((await read(resumeDraft!.id)).outdated, [
      'The app has a newer text of this job.',
    ]);
  });

  test('records failed calls and keeps no draft from them', async () => {
    const fresh = (await paste()).snapshot!.id;
    const failures = async () =>
      (
        await pool.query(
          `select failure_reason, input_tokens from model_call
           where job_snapshot_id = $1 and purpose = 'draft' order by started_at`,
          [fresh],
        )
      ).rows;

    answer = async () => new Response('Service Unavailable', { status: 503 });
    const down = await draft(fresh);
    assert.equal(down.statusCode, 502);
    assert.equal(down.json().message, 'DeepSeek answered HTTP 503. Try again later.');

    answer = async () => chatCompletion(JSON.stringify({ resume: 'all good' }));
    assert.equal(
      (await draft(fresh)).json().message,
      'The answer from DeepSeek does not have the expected fields.',
    );

    answer = async () =>
      chatCompletion(JSON.stringify({ headline: null, summary: [{ text: ' ', facts: [] }] }));
    assert.equal((await draft(fresh)).json().message, 'DeepSeek wrote no statements.');

    assert.deepEqual(await failures(), [
      { failure_reason: 'DeepSeek answered HTTP 503. Try again later.', input_tokens: null },
      {
        failure_reason: 'The answer from DeepSeek does not have the expected fields.',
        input_tokens: 3000,
      },
      { failure_reason: 'DeepSeek wrote no statements.', input_tokens: 3000 },
    ]);
    assert.equal(await count('artifact where job_snapshot_id = $1', [fresh]), 0);
  });

  test('writes one draft of a kind for a job text at a time', async () => {
    const fresh = (await paste()).snapshot!.id;
    let release = () => {};
    answer = () => new Promise<Response>((resolve) => (release = () => resolve(normally())));
    const requests = deepseek.requests.length;
    const first = draft(fresh);
    while (deepseek.requests.length === requests) await new Promise((r) => setTimeout(r, 10));
    const second = await draft(fresh);
    assert.equal(second.statusCode, 409);
    assert.match(second.json().message, /already being written/);
    release();
    assert.equal((await first).statusCode, 201);
  });

  test('an unknown draft is not found', async () => {
    assert.equal((await call({ method: 'GET', url: `/api/drafts/${uuid}` })).statusCode, 404);
  });
});
