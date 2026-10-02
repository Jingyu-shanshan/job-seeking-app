import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Criteria, Fact, FactKind, JobDetail, JobsResponse } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { summaryFieldKeys } from '../rules/job-summary.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
import { matchSystemPrompt } from './match.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

const defaults: Criteria = {
  location: { strength: 'hard', ifUnknown: 'to_confirm', area: 'helsinki', includeRemote: false },
  title: { strength: 'off', words: [] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { strength: 'off', ifUnknown: 'to_confirm', languages: [] },
  employmentType: { strength: 'off', ifUnknown: 'to_confirm', types: [] },
  mustHaves: { strength: 'preference', ifUnknown: 'to_confirm' },
};

const jobText = `Platform Engineer

What you bring
- 3+ years of Go
- Fluent English
- Kubernetes is a plus

We work in English. This is a full-time, permanent role in Helsinki.`;

const nullFields = Object.fromEntries(summaryFieldKeys.map((key) => [key, null]));

const summaryAnswer = {
  responsibilities: [],
  requirements: [
    { kind: 'must', text: '3+ years of Go', quote: '3+ years of Go' },
    { kind: 'must', text: 'Fluent English', quote: 'Fluent English' },
    { kind: 'nice', text: 'Kubernetes', quote: 'Kubernetes is a plus' },
    // Its quote is not in the text, so it is to be confirmed and never sent to be matched.
    { kind: 'must', text: 'A degree in computer science', quote: 'Degree in CS' },
  ],
  fields: {
    ...nullFields,
    languages: { value: 'English', quote: 'We work in English.' },
    employmentType: { value: 'Full-time, permanent', quote: 'a full-time, permanent role' },
  },
};

interface SentMatch {
  requirements: { ref: string; kind: string; text: string; quote: string }[];
  facts: { ref: string; category: string; text: string }[];
}

type Decide = (sent: SentMatch) => unknown;

/**
 * Answers each requirement named in `picks` with the outcome given, citing the first fact sent
 * whose text includes the words given; every other requirement is unknown.
 */
const cite =
  (picks: Record<string, [words: string, outcome: 'met' | 'unmet']>): Decide =>
  (sent) => ({
    requirements: sent.requirements.map(({ ref, text }) => {
      const [words, outcome] = picks[text] ?? [];
      const fact = words && sent.facts.find((f) => f.text.includes(words));
      return fact
        ? { ref, outcome, facts: [fact.ref], note: `${fact.ref} says so.` }
        : { ref, outcome: 'unknown', facts: [], note: 'No fact mentions it.' };
    }),
  });

const meetsAll = cite({
  '3+ years of Go': ['Go at a payments company', 'met'],
  'Fluent English': ['English: fluent', 'met'],
});

describe('criteria and evidence matching', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let decide: Decide = meetsAll;
  // Summaries get `summaryAnswer`, matches what `decide` makes of the request.
  const normally = async () => {
    const sent = deepseek.requests.at(-1)!;
    if (sent.body.messages[0]!.content !== matchSystemPrompt) {
      return chatCompletion(JSON.stringify(summaryAnswer));
    }
    return chatCompletion(JSON.stringify(decide(JSON.parse(sent.body.messages[1]!.content))));
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

  const call = (options: InjectOptions, on = app) =>
    on.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const putCriteria = (criteria: Criteria) =>
    call({ method: 'PUT', url: '/api/criteria', payload: criteria });

  beforeEach(async () => {
    decide = meetsAll;
    answer = normally;
    assert.equal((await putCriteria(defaults)).statusCode, 200);
  });

  const detail = async (jobId: string) => {
    const res = await call({ method: 'GET', url: `/api/jobs/${jobId}` });
    assert.equal(res.statusCode, 200);
    return res.json<JobDetail>();
  };

  const listed = async (jobId: string) => {
    const { jobs } = (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>();
    return jobs.find((j) => j.id === jobId)!;
  };

  let pasted = 0;
  const paste = async (title = 'Platform Engineer', location = 'Helsinki, Finland') => {
    const res = await call({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        title,
        location,
        url: 'https://careers.example.com/jobs/1',
        // Each job its own text, so that each has its own summary.
        text: `${jobText}\nJob ${++pasted}.`,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json<JobDetail>();
  };

  const summarise = async (job: JobDetail) => {
    const res = await call({ method: 'POST', url: `/api/snapshots/${job.snapshot!.id}/summary` });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<JobDetail>();
  };

  const match = (snapshotId: string, on = app) =>
    call({ method: 'POST', url: `/api/snapshots/${snapshotId}/match` }, on);

  const addFact = async (
    kind: FactKind,
    body: string,
    change: { status?: string; maySendToModel?: boolean; mayUseInMaterials?: boolean } = {
      status: 'confirmed',
      maySendToModel: true,
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

  const count = async (table: string, values: unknown[] = []) =>
    (await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`, values)).rows[0]!.n;

  test('refuses requests without a session, and writes from another site', async () => {
    for (const [method, url] of [
      ['GET', '/api/criteria'],
      ['PUT', '/api/criteria'],
      ['POST', `/api/snapshots/${uuid}/match`],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: appUrl }, payload: {} });
      assert.equal(res.statusCode, 401, url);
      if (method !== 'GET') {
        const cross = await call({ method, url, headers: { origin: 'https://evil.example' } });
        assert.equal(cross.statusCode, 403, url);
      }
    }
    assert.deepEqual(deepseek.requests, []);
  });

  test('keeps the criteria, tidied, and refuses ones it cannot check', async () => {
    assert.deepEqual((await call({ method: 'GET', url: '/api/criteria' })).json(), defaults);

    const wanted: Criteria = {
      location: {
        strength: 'preference',
        ifUnknown: 'rule_out',
        area: 'finland',
        includeRemote: true,
      },
      title: { strength: 'hard', words: [' backend ', 'Backend', 'platform   engineer'] },
      avoidInTitle: { strength: 'preference', words: ['senior'] },
      languages: { strength: 'hard', ifUnknown: 'rule_out', languages: ['English', 'english '] },
      employmentType: {
        strength: 'hard',
        ifUnknown: 'to_confirm',
        types: ['full_time', 'full_time'],
      },
      mustHaves: { strength: 'off', ifUnknown: 'to_confirm' },
    };
    const res = await putCriteria(wanted);
    assert.equal(res.statusCode, 200, res.body);
    const tidy: Criteria = {
      ...wanted,
      title: { strength: 'hard', words: ['backend', 'platform engineer'] },
      languages: { ...wanted.languages, languages: ['English'] },
      employmentType: { ...wanted.employmentType, types: ['full_time'] },
    };
    assert.deepEqual(res.json(), tidy);
    assert.deepEqual((await call({ method: 'GET', url: '/api/criteria' })).json(), tidy);

    for (const [wrong, message] of [
      [
        { ...tidy, languages: { ...tidy.languages, languages: ['English', 'Klingon'] } },
        '“Klingon” is not a language the app recognises.',
      ],
      [
        { ...tidy, title: { strength: 'preference', words: [] } },
        'Add words for the job title, or turn that criterion off.',
      ],
      [
        { ...tidy, employmentType: { ...tidy.employmentType, types: [] } },
        'Add an employment type you accept, or turn that criterion off.',
      ],
      [{ ...tidy, mustHaves: { strength: 'must', ifUnknown: 'to_confirm' } }, undefined],
      [{ ...tidy, location: { ...tidy.location, area: 'everywhere' } }, undefined],
      [{ title: tidy.title }, undefined],
    ] as const) {
      const refused = await putCriteria(wrong as unknown as Criteria);
      assert.equal(refused.statusCode, 400, JSON.stringify(wrong));
      if (message) assert.equal(refused.json().message, message);
    }
    assert.deepEqual((await call({ method: 'GET', url: '/api/criteria' })).json(), tidy);
  });

  test('sorts jobs by the hard criteria, with the reason for each, in the list and the job', async () => {
    const backend = await paste('Backend Engineer');
    const senior = await paste('Senior Backend Engineer');
    const designer = await paste('Designer');
    const berlin = await paste('Backend Engineer', 'Berlin, Germany');
    await putCriteria({
      ...defaults,
      title: { strength: 'hard', words: ['backend'] },
      avoidInTitle: { strength: 'hard', words: ['senior'] },
      languages: { strength: 'hard', ifUnknown: 'to_confirm', languages: ['English'] },
      mustHaves: { strength: 'off', ifUnknown: 'to_confirm' },
    });

    const reasons = async (jobId: string) => {
      const job = await listed(jobId);
      return [job.verdict, job.criteria.filter((c) => c.effect !== 'none').map((c) => c.reason)];
    };
    assert.deepEqual(await reasons(backend.id), [
      'to_confirm',
      ['Summarise the job to find its working language.'],
    ]);
    assert.deepEqual(await reasons(senior.id), [
      'ineligible',
      ['The title has “senior”.', 'Summarise the job to find its working language.'],
    ]);
    assert.deepEqual(await reasons(designer.id), [
      'ineligible',
      ['The title has none of “backend”.', 'Summarise the job to find its working language.'],
    ]);
    assert.deepEqual(await reasons(berlin.id), [
      'ineligible',
      ['Not in Helsinki or Espoo.', 'Summarise the job to find its working language.'],
    ]);

    // The summary states the language, with a quote that is in the text.
    await summarise(backend);
    assert.deepEqual(await reasons(backend.id), ['eligible', []]);
    const language = (await listed(backend.id)).criteria.find((c) => c.criterion === 'languages');
    assert.deepEqual(language, {
      criterion: 'languages',
      strength: 'hard',
      outcome: 'met',
      effect: 'none',
      reason: 'It is done in English.',
      quote: 'We work in English.',
    });
    const page = await detail(backend.id);
    const inList = await listed(backend.id);
    assert.deepEqual([page.verdict, page.criteria], [inList.verdict, inList.criteria]);

    // Ruling out unknowns is the user's choice, and says why.
    await putCriteria({
      ...defaults,
      languages: { strength: 'hard', ifUnknown: 'rule_out', languages: ['English'] },
      employmentType: { strength: 'hard', ifUnknown: 'to_confirm', types: ['part_time'] },
    });
    assert.deepEqual(await reasons(designer.id), [
      'ineligible',
      [
        'Summarise the job to find its working language.',
        'Summarise the job to find its employment type.',
      ],
    ]);
    assert.deepEqual(await reasons(backend.id), ['ineligible', ['It is full-time.']]);
    assert.deepEqual(
      deepseek.requests.filter((r) => r.body.messages[0]!.content === matchSystemPrompt),
      [],
    );
  });

  test('matches a job text once, sending only checked requirements and facts that may go', async () => {
    const job = await paste();
    const snapshotId = job.snapshot!.id;
    assert.equal(job.factsToSend, 0);

    const noRequirements = await match(snapshotId);
    assert.equal(noRequirements.statusCode, 409);
    assert.match(noRequirements.json().message, /Summarise the job/);
    await summarise(job);

    const noFacts = await match(snapshotId);
    assert.equal(noFacts.statusCode, 409);
    assert.match(noFacts.json().message, /None of your facts may be sent/);

    await addFact('skill', 'Four years of Go at a payments company.');
    await addFact('language', 'English: fluent.');
    await addFact('experience', 'Built a billing service in Rust.', {});
    await addFact('skill', 'Some Rust at home.', { status: 'confirmed', mayUseInMaterials: true });
    await addFact('statement', 'Write to someone@example.com about Go.', {
      status: 'confirmed',
      mayUseInMaterials: true,
    });

    const withoutKey = buildApp(options());
    try {
      assert.equal((await match(snapshotId, withoutKey)).statusCode, 503);
    } finally {
      await withoutKey.close();
    }
    assert.equal((await match(uuid)).statusCode, 404);

    const requests = deepseek.requests.length;
    const res = await match(snapshotId);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(deepseek.requests.length, requests + 1);
    const request = deepseek.requests.at(-1)!;
    assert.equal(request.body.messages[0]!.content, matchSystemPrompt);
    const sent: SentMatch = JSON.parse(request.body.messages[1]!.content);
    assert.deepEqual(sent.requirements.map((r) => [r.kind, r.text, r.quote]).sort(), [
      ['must', '3+ years of Go', '3+ years of Go'],
      ['must', 'Fluent English', 'Fluent English'],
      ['nice', 'Kubernetes', 'Kubernetes is a plus'],
    ]);
    assert.deepEqual(
      sent.facts.map((f) => [f.category, f.text]),
      [
        ['skill', 'Four years of Go at a payments company.'],
        ['language', 'English: fluent.'],
      ],
    );
    // Nothing else about the user, and not the job text either.
    assert.deepEqual(Object.keys(sent), ['requirements', 'facts']);
    for (const absent of ['someone@example.com', 'billing service', 'Some Rust', 'Job ']) {
      assert.ok(!request.body.messages[1]!.content.includes(absent), absent);
    }

    const matched = res.json<JobDetail>();
    assert.deepEqual(
      { ...matched.snapshot!.match, createdAt: undefined },
      {
        createdAt: undefined,
        model: 'deepseek-flash',
        costUsd: 0.001206,
        factsSent: 2,
        outdated: [],
      },
    );
    const evidence = Object.fromEntries(
      matched.snapshot!.requirements.map((r) => [
        r.text,
        r.evidence && [
          r.evidence.outcome,
          r.evidence.facts.map((f) => [f.body, f.version, f.current]),
        ],
      ]),
    );
    assert.deepEqual(evidence, {
      '3+ years of Go': ['met', [['Four years of Go at a payments company.', 1, true]]],
      'Fluent English': ['met', [['English: fluent.', 1, true]]],
      Kubernetes: ['unknown', []],
      'A degree in computer science': null,
    });
    assert.deepEqual(
      matched.criteria.find((c) => c.criterion === 'mustHaves'),
      {
        criterion: 'mustHaves',
        strength: 'preference',
        outcome: 'met',
        effect: 'none',
        reason: 'Your facts meet all 2 must-haves.',
        quote: null,
      },
    );
    assert.equal(matched.factsToSend, 2);

    const { rows } = await pool.query(
      `select m.verdict, c.purpose, c.failure_reason,
         (select count(*)::int from match_fact f where f.match_id = m.id) as sent,
         (select count(*)::int from match_requirement r where r.match_id = m.id) as outcomes
       from match m join model_call c on c.id = m.model_call_id where m.job_snapshot_id = $1`,
      [snapshotId],
    );
    assert.deepEqual(rows, [
      { verdict: 'eligible', purpose: 'match', failure_reason: null, sent: 2, outcomes: 3 },
    ]);

    // The same facts and requirements again: refused, and nothing is sent.
    const again = await match(snapshotId);
    assert.equal(again.statusCode, 409);
    assert.equal(
      again.json().message,
      'This job is already matched with your current facts and requirements.',
    );
    assert.equal(deepseek.requests.length, requests + 1);
  });

  test('a match goes out of date when facts or requirements change, and stops counting', async () => {
    const job = await summarise(await paste('Go Engineer'));
    const snapshotId = job.snapshot!.id;
    const go = await addFact('skill', 'Three years of Go in production.');
    await addFact('language', 'English at work every day.');
    decide = cite({
      '3+ years of Go': ['Go in production', 'met'],
      'Fluent English': ['English at work', 'met'],
    });
    assert.equal((await match(snapshotId)).statusCode, 200);
    await putCriteria({ ...defaults, mustHaves: { strength: 'hard', ifUnknown: 'to_confirm' } });
    const mustHaves = async () => {
      const j = await listed(job.id);
      const c = j.criteria.find((r) => r.criterion === 'mustHaves')!;
      return [j.verdict, c.outcome, c.reason];
    };
    assert.deepEqual(await mustHaves(), ['eligible', 'met', 'Your facts meet all 2 must-haves.']);

    // Editing a cited fact adds a version to confirm: the outcome it supported no longer counts.
    const edited = await call({
      method: 'POST',
      url: `/api/facts/${go.id}/versions`,
      payload: { body: 'Four years of Go in production.' },
    });
    assert.equal(edited.statusCode, 201);
    const stale = await detail(job.id);
    assert.deepEqual(stale.snapshot!.match!.outdated, [
      'The facts that may be sent to DeepSeek have changed since.',
    ]);
    const goRequirement = stale.snapshot!.requirements.find((r) => r.text === '3+ years of Go')!;
    assert.deepEqual(
      goRequirement.evidence!.facts.map((f) => [f.body, f.version, f.current]),
      [['Three years of Go in production.', 1, false]],
    );
    assert.deepEqual(await mustHaves(), [
      'to_confirm',
      'unknown',
      'No evidence in your facts for “3+ years of Go”.',
    ]);

    // Confirmed and allowed again, the new version goes with a new match; the old match is kept.
    const version = edited.json<Fact>().current;
    await call({
      method: 'PATCH',
      url: `/api/fact-versions/${version.id}`,
      payload: { status: 'confirmed', maySendToModel: true },
    });
    decide = cite({
      '3+ years of Go': ['Go in production', 'met'],
      'Fluent English': ['English at work', 'unmet'],
    });
    assert.equal((await match(snapshotId)).statusCode, 200);
    assert.equal(await count('match where job_snapshot_id = $1', [snapshotId]), 2);
    const now = await detail(job.id);
    assert.deepEqual(now.snapshot!.match!.outdated, []);
    assert.deepEqual(await mustHaves(), [
      'ineligible',
      'unmet',
      'Your facts do not meet “Fluent English”.',
    ]);
    assert.equal(
      (await listed(job.id)).criteria.find((c) => c.criterion === 'mustHaves')!.quote,
      'Fluent English',
    );

    // Removing a requirement changes what a match would send.
    const kubernetes = now.snapshot!.requirements.find((r) => r.text === 'Kubernetes')!;
    await call({ method: 'DELETE', url: `/api/requirements/${kubernetes.id}` });
    assert.deepEqual((await detail(job.id)).snapshot!.match!.outdated, [
      'The requirements have changed since.',
    ]);
  });

  test('records a failed match with its cost, and keeps no outcome from it', async () => {
    const job = await summarise(await paste('Failing Engineer'));
    const snapshotId = job.snapshot!.id;
    const failures = async () =>
      (
        await pool.query(
          `select failure_reason, input_tokens from model_call
           where job_snapshot_id = $1 and purpose = 'match' order by started_at`,
          [snapshotId],
        )
      ).rows;

    answer = async () => new Response('Service Unavailable', { status: 503 });
    const down = await match(snapshotId);
    assert.equal(down.statusCode, 502);
    assert.equal(down.json().message, 'DeepSeek answered HTTP 503. Try again later.');

    answer = async () => chatCompletion(JSON.stringify({ matches: 'all good' }));
    const wrongShape = await match(snapshotId);
    assert.equal(wrongShape.statusCode, 502);
    assert.equal(
      wrongShape.json().message,
      'The answer from DeepSeek does not have the expected fields.',
    );
    answer = normally;

    assert.deepEqual(await failures(), [
      { failure_reason: 'DeepSeek answered HTTP 503. Try again later.', input_tokens: null },
      {
        failure_reason: 'The answer from DeepSeek does not have the expected fields.',
        input_tokens: 3000,
      },
    ]);
    assert.equal(await count('match where job_snapshot_id = $1', [snapshotId]), 0);
    assert.equal((await detail(job.id)).snapshot!.match, null);

    // Facts the request did not hold cannot be cited: met without one is unknown.
    decide = (sent) => ({
      requirements: sent.requirements.map(({ ref }) => ({
        ref,
        outcome: 'met',
        facts: ['F99'],
        note: 'Surely.',
      })),
    });
    assert.equal((await match(snapshotId)).statusCode, 200);
    const outcomes = (await detail(job.id))
      .snapshot!.requirements.filter((r) => r.evidence)
      .map((r) => [r.evidence!.outcome, r.evidence!.facts]);
    assert.deepEqual(outcomes, [
      ['unknown', []],
      ['unknown', []],
      ['unknown', []],
    ]);
    assert.equal(
      await count(
        'match_evidence e join match m on m.id = e.match_id where m.job_snapshot_id = $1',
        [snapshotId],
      ),
      0,
    );
  });

  test('matches one job text at a time', async () => {
    const job = await summarise(await paste('Slow Engineer'));
    const snapshotId = job.snapshot!.id;
    let release = () => {};
    answer = () => new Promise<Response>((resolve) => (release = () => resolve(normally())));
    const first = match(snapshotId);
    while (deepseek.requests.at(-1)?.body.messages[0]!.content !== matchSystemPrompt) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const second = await match(snapshotId);
    assert.equal(second.statusCode, 409);
    assert.match(second.json().message, /already being matched/);
    release();
    assert.equal((await first).statusCode, 200);
  });
});
