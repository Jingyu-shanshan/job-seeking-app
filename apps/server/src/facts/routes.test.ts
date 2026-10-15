import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  Fact,
  FactCandidate,
  FactsResponse,
  ImportFactsResponse,
  PreviewFactsResponse,
  SaveFactCandidatesResponse,
} from '@jsa/shared';
import { maxPdfBytes } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { pdfOf } from '../testing/pdf.ts';
import { loadFactState } from '../matching/check.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

describe('/api/facts', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
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

  const add = async (kind: string, body: string) => {
    const res = await call({ method: 'POST', url: '/api/facts', payload: { kind, body } });
    assert.equal(res.statusCode, 201, res.body);
    return res.json<Fact>();
  };

  const patch = (versionId: string, payload: Record<string, unknown>) =>
    call({ method: 'PATCH', url: `/api/fact-versions/${versionId}`, payload });

  const edit = (factId: string, body: string) =>
    call({ method: 'POST', url: `/api/facts/${factId}/versions`, payload: { body } });

  test('refuses every request without a session, and writes from another site', async () => {
    for (const [method, url] of [
      ['GET', '/api/facts'],
      ['POST', '/api/facts'],
      ['POST', `/api/facts/${uuid}/versions`],
      ['PATCH', `/api/fact-versions/${uuid}`],
      ['POST', '/api/facts/import'],
      ['POST', '/api/facts/import/preview/markdown'],
      ['POST', '/api/facts/import/preview/pdf?fileName=sample.pdf'],
      ['POST', '/api/facts/import/candidates'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: appUrl }, payload: {} });
      assert.equal(res.statusCode, 401, url);
      if (method !== 'GET') {
        const cross = await call({ method, url, headers: { origin: 'https://evil.example' } });
        assert.equal(cross.statusCode, 403, url);
      }
    }
  });

  test('a new fact is proposed and used nowhere until confirmed with its flags', async () => {
    const fact = await add('experience', '  Maintained the invoice export service.  ');
    assert.deepEqual(
      [
        fact.kind,
        fact.current.version,
        fact.current.body,
        fact.current.status,
        fact.current.source,
      ],
      ['experience', 1, 'Maintained the invoice export service.', 'proposed', 'manual'],
    );
    assert.deepEqual([fact.current.maySendToModel, fact.current.mayUseInMaterials], [false, false]);
    assert.deepEqual([fact.sendableToModel, fact.usableInMaterials], [false, false]);

    const flagged = (
      await patch(fact.current.id, { maySendToModel: true, mayUseInMaterials: true })
    ).json<Fact>();
    assert.deepEqual([flagged.sendableToModel, flagged.usableInMaterials], [false, false]);

    const confirmed = (await patch(fact.current.id, { status: 'confirmed' })).json<Fact>();
    assert.deepEqual([confirmed.sendableToModel, confirmed.usableInMaterials], [true, true]);
  });

  test('editing adds a new proposed version that must be confirmed again', async () => {
    const fact = await add('skill', 'TypeScript');
    await patch(fact.current.id, {
      status: 'confirmed',
      maySendToModel: true,
      mayUseInMaterials: true,
    });

    assert.equal((await edit(fact.id, ' TypeScript ')).statusCode, 409);
    const res = await edit(fact.id, 'TypeScript and Node.js');
    assert.equal(res.statusCode, 201);
    const edited = res.json<Fact>();
    assert.deepEqual(
      [edited.current.version, edited.current.status, edited.current.maySendToModel],
      [2, 'proposed', false],
    );
    assert.deepEqual(
      edited.earlier.map((v) => [v.version, v.body, v.status]),
      [[1, 'TypeScript', 'confirmed']],
    );
    assert.deepEqual([edited.sendableToModel, edited.usableInMaterials], [false, false]);

    const old = await patch(fact.current.id, { status: 'retired' });
    assert.equal(old.statusCode, 409);
    assert.match(old.json().message, /Only the current version/);

    const { rows } = await pool.query(
      'select body from fact_version where fact_id = $1 order by version',
      [fact.id],
    );
    assert.deepEqual(
      rows.map((r) => r.body),
      ['TypeScript', 'TypeScript and Node.js'],
    );
  });

  test('a fact is withdrawn by retiring it, and can be confirmed again', async () => {
    const fact = await add('statement', 'I enjoy boring, reliable systems.');
    await patch(fact.current.id, { status: 'confirmed', mayUseInMaterials: true });
    const retired = (await patch(fact.current.id, { status: 'retired' })).json<Fact>();
    assert.deepEqual([retired.current.status, retired.usableInMaterials], ['retired', false]);
    assert.equal((await patch(fact.current.id, { status: 'proposed' })).statusCode, 409);
    const again = (await patch(fact.current.id, { status: 'confirmed' })).json<Fact>();
    assert.equal(again.usableInMaterials, true);
  });

  test('a fact with contact details may not go to the model', async () => {
    const fact = await add('other', 'Contact: me@example.com, +358 40 123 4567');
    assert.deepEqual(fact.sensitive, ['an email address', 'a phone number']);
    const res = await patch(fact.current.id, { maySendToModel: true });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /an email address and a phone number/);
    const materials = (
      await patch(fact.current.id, { status: 'confirmed', mayUseInMaterials: true })
    ).json<Fact>();
    assert.deepEqual([materials.usableInMaterials, materials.sendableToModel], [true, false]);
  });

  test('work permit and salary facts cannot be enabled for the model', async () => {
    for (const body of [
      'Holds a residence permit for Finland.',
      'Expects a salary of 5000 euros.',
    ]) {
      const fact = await add('other', body);
      const res = await patch(fact.current.id, { status: 'confirmed', maySendToModel: true });
      assert.equal(res.statusCode, 400);
      assert.match(res.json().message, /never goes to the model provider/);
    }
  });

  test('imports Markdown as proposed facts, once', async () => {
    const markdown =
      '## Work experience\n- Acme Oy, backend developer, 2021–2024\n\n## Skills\n- PostgreSQL\n- TypeScript\n';
    const res = await call({ method: 'POST', url: '/api/facts/import', payload: { markdown } });
    assert.equal(res.statusCode, 200, res.body);
    const imported = res.json<ImportFactsResponse>();
    assert.deepEqual([imported.added, imported.skipped], [3, 0]);
    const fromMarkdown = imported.facts.filter((f) => f.current.source === 'markdown');
    assert.deepEqual(
      fromMarkdown.map((f) => [f.kind, f.current.body, f.current.status, f.current.maySendToModel]),
      [
        ['experience', 'Acme Oy, backend developer, 2021–2024', 'proposed', false],
        ['skill', 'PostgreSQL', 'proposed', false],
        ['skill', 'TypeScript', 'proposed', false],
      ],
    );

    const again = (
      await call({ method: 'POST', url: '/api/facts/import', payload: { markdown } })
    ).json<ImportFactsResponse>();
    assert.deepEqual([again.added, again.skipped], [0, 3]);

    const empty = await call({
      method: 'POST',
      url: '/api/facts/import',
      payload: { markdown: '# Facts' },
    });
    assert.equal(empty.statusCode, 400);
  });

  test('lists facts grouped by kind', async () => {
    const { facts } = (await call({ method: 'GET', url: '/api/facts' })).json<FactsResponse>();
    const kinds = facts.map((f) => f.kind);
    assert.deepEqual(
      kinds,
      [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    );
  });

  const candidate = (body: string, fields: Partial<FactCandidate> = {}): FactCandidate => ({
    body,
    kind: 'other',
    selected: true,
    source: {
      type: 'pdf',
      fileName: 'PRIVATE_SAMPLE_FILENAME.pdf',
      pages: [1],
      sha256: 'a'.repeat(64),
      edited: true,
    },
    ...fields,
  });
  const save = (candidates: unknown[]) =>
    call({ method: 'POST', url: '/api/facts/import/candidates', payload: { candidates } });
  const countFacts = async () =>
    Number((await pool.query('select count(*) as n from fact')).rows[0]!.n);

  test('previews Markdown and PDF without writes or model calls and marks current withdrawn duplicates', async () => {
    const before = await countFacts();
    const callsBefore = (await pool.query('select count(*) as n from model_call')).rows[0]!.n;
    const md = await call({
      method: 'POST',
      url: '/api/facts/import/preview/markdown',
      payload: {
        markdown: '## 技能\n- Preview-only text\n- Preview-only text',
        fileName: 'sample.md',
      },
    });
    assert.equal(md.statusCode, 200, md.body);
    const preview = md.json<PreviewFactsResponse>();
    assert.deepEqual(
      preview.candidates.map((c) => [c.kind, c.selected, c.duplicate?.status]),
      [
        ['skill', true, undefined],
        ['skill', false, 'batch'],
      ],
    );
    const pdf = await call({
      method: 'POST',
      url: '/api/facts/import/preview/pdf?fileName=sample.pdf',
      headers: { 'content-type': 'application/pdf' },
      payload: pdfOf(['Skills', 'PDF-only text'], ['Languages', 'English (fluent)']),
    });
    assert.equal(pdf.statusCode, 200, pdf.body);
    assert.equal(pdf.json<PreviewFactsResponse>().pages.length, 2);
    assert.equal(await countFacts(), before);
    assert.equal(
      (await pool.query('select count(*) as n from model_call')).rows[0]!.n,
      callsBefore,
    );
    const existing = await add('other', 'Withdrawn duplicate for preview');
    await patch(existing.current.id, { status: 'retired', mayUseInMaterials: true });
    const duplicate = await call({
      method: 'POST',
      url: '/api/facts/import/preview/markdown',
      payload: { markdown: existing.current.body },
    });
    assert.deepEqual(duplicate.json<PreviewFactsResponse>().candidates[0]!.duplicate, {
      status: 'retired',
      factId: existing.id,
    });
    assert.equal(duplicate.json<PreviewFactsResponse>().candidates[0]!.selected, false);
  });

  test('rejects spoofed, empty, broken, image-only, oversized and excessive-page PDF uploads', async () => {
    for (const [payload, status, pattern] of [
      [Buffer.from('Not PDF bytes'), 400, /not a PDF/],
      [Buffer.alloc(0), 400, /empty/],
      [Buffer.from('%PDF-1.4 broken'), 400, /could not be read/],
      [pdfOf([]), 400, /text layer/],
      [pdfOf(...Array.from({ length: 21 }, () => ['page'])), 400, /more than 20 pages/],
      [Buffer.alloc(maxPdfBytes + 1), 413, /too large/i],
    ] as const) {
      const res = await call({
        method: 'POST',
        url: '/api/facts/import/preview/pdf?fileName=pretend.pdf',
        headers: { 'content-type': 'application/pdf' },
        payload,
      });
      assert.equal(res.statusCode, status, res.body);
      assert.match(res.json().message, pattern);
    }
    const wrongMime = await call({
      method: 'POST',
      url: '/api/facts/import/preview/pdf?fileName=sample.pdf',
      payload: { text: 'pretend' },
    });
    assert.equal(wrongMime.statusCode, 400);
  });

  test('saves corrected text verbatim with provenance, proposed and both permissions off, and excludes source from model state', async () => {
    const body = '  Sample Unicode 项目, PostgreSQL 2021–2024\n30% faster.  ';
    const res = await save([candidate(body, { kind: 'project' })]);
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json<SaveFactCandidatesResponse>();
    assert.deepEqual([result.added, result.skipped, result.cancelled], [1, 0, 0]);
    const f = result.facts.find((f) => f.current.body === body)!;
    assert.ok(f);
    assert.deepEqual(
      [f.current.status, f.current.maySendToModel, f.current.mayUseInMaterials],
      ['proposed', false, false],
    );
    assert.deepEqual(JSON.parse(f.current.source), candidate(body).source);
    await patch(f.current.id, {
      status: 'confirmed',
      maySendToModel: true,
      mayUseInMaterials: true,
    });
    const state = await loadFactState(pool);
    assert.ok(state.sendable.some((f) => f.body === body));
    assert.ok(!JSON.stringify(state).includes('PRIVATE_SAMPLE_FILENAME'));
    assert.ok(!JSON.stringify(state.citable).includes('sha256'));
  });

  test('deduplicates current and same-batch text, skips withdrawn without restoring, and allows old-history text', async () => {
    const existing = await add('other', 'Earlier import text');
    await edit(existing.id, 'Current import text');
    const withdrawn = await add('other', 'Retired import text');
    await patch(withdrawn.current.id, {
      status: 'retired',
      maySendToModel: true,
      mayUseInMaterials: true,
    });
    const res = await save([
      candidate('Current\nimport text'),
      candidate('Retired  import text'),
      candidate('Earlier import text'),
      candidate('Earlier  import text'),
      candidate('cancelled import', { selected: false }),
    ]);
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json<SaveFactCandidatesResponse>();
    assert.deepEqual([result.added, result.skipped, result.cancelled], [1, 3, 1]);
    assert.deepEqual(
      result.duplicates.map((d) => d.status),
      ['active', 'retired', 'batch'],
    );
    const kept = result.facts.find((f) => f.id === withdrawn.id)!;
    assert.deepEqual(
      [kept.current.status, kept.current.maySendToModel, kept.current.mayUseInMaterials],
      ['retired', true, true],
    );
    const again = (
      await save([candidate('Current import text'), candidate('Retired import text')])
    ).json<SaveFactCandidatesResponse>();
    assert.deepEqual([again.added, again.skipped], [0, 2]);
    const cancelled = (
      await save([candidate('all cancelled', { selected: false })])
    ).json<SaveFactCandidatesResponse>();
    assert.deepEqual([cancelled.added, cancelled.skipped, cancelled.cancelled], [0, 0, 1]);
    assert.equal((await save([])).json<SaveFactCandidatesResponse>().added, 0);
  });

  test('validates selected bodies, aggregate text, counts, categories and source metadata on saving', async () => {
    for (const candidates of [
      [candidate(' ')],
      [candidate('x'.repeat(5001))],
      Array.from({ length: 41 }, () => candidate('x'.repeat(5000))),
      Array.from({ length: 201 }, () => candidate('a')),
      [candidate('bad category', { kind: 'made_up' as Fact['kind'] })],
      [
        {
          ...candidate('bad source'),
          source: {
            type: 'pdf',
            fileName: 'sample.pdf',
            pages: [21],
            sha256: 'fake',
            edited: false,
          },
        },
      ],
      [{ ...candidate('bad type'), selected: { yes: true } }],
    ]) {
      const res = await save(candidates);
      assert.equal(res.statusCode, 400, res.body);
    }
    const cancelled = await save([candidate(' ', { selected: false })]);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
  });

  test('rolls back a failed whole batch and serializes concurrent retries', async () => {
    const before = await countFacts();
    await pool.query(`create function reject_sample_import() returns trigger language plpgsql as $$ begin if new.body = 'Reject sample import' then raise exception 'sample import failure'; end if; return new; end $$;
      create trigger reject_sample_import before insert on fact_version for each row execute function reject_sample_import();`);
    try {
      assert.equal(
        (await save([candidate('Before rejected sample'), candidate('Reject sample import')]))
          .statusCode,
        500,
      );
      assert.equal(await countFacts(), before);
    } finally {
      await pool.query(
        'drop trigger reject_sample_import on fact_version; drop function reject_sample_import()',
      );
    }
    const results = await Promise.all(
      Array.from({ length: 3 }, () => save([candidate('Concurrent import once')])),
    );
    assert.ok(results.every((r) => r.statusCode === 200));
    assert.equal(
      results.reduce((n, r) => n + r.json<SaveFactCandidatesResponse>().added, 0),
      1,
    );
  });
});

const order = [
  'experience',
  'project',
  'education',
  'skill',
  'language',
  'certification',
  'statement',
  'other',
];
