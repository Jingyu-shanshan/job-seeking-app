import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Fact, FactsResponse, ImportFactsResponse } from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';

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
