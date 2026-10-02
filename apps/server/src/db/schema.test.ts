import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';

// The invariants the schema itself enforces. Rules that need judgement (which facts may be
// cited, status transitions) belong in the pure rules module, not here.

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const immutable = /is immutable/;
const foreignKey = { code: '23503' };

describe('schema', needsDatabase, () => {
  let db: TestDatabase;
  let client: Client;

  before(async () => {
    db = await createTestDatabase();
    client = new Client({ connectionString: db.url });
    await client.connect();
  });

  after(async () => {
    await client?.end();
    await db?.drop();
  });

  async function row(text: string, values: unknown[] = []) {
    const result = await client.query(text, values);
    assert.equal(result.rowCount, 1, text);
    return result.rows[0];
  }

  async function newFactVersion(body = 'Maintained the invoice export service.') {
    const fact = await row('insert into fact default values returning id');
    return row(
      `insert into fact_version (fact_id, version, body, source) values ($1, 1, $2, 'manual') returning *`,
      [fact.id, body],
    );
  }

  // 插入快照时必填的来源列，顺序对应 $2 之后的参数。
  const snapshotColumns = 'job_id, body, catalog_id, title, source_url';
  const snapshotSource = ['paste', 'Billing engineer', 'https://example.com/jobs/1'];

  async function newSnapshot(body = 'We are hiring a billing engineer. You know PostgreSQL.') {
    const job = await row('insert into job default values returning id');
    return row(
      `insert into job_snapshot (${snapshotColumns}) values ($1, $2, $3, $4, $5) returning *`,
      [job.id, body, ...snapshotSource],
    );
  }

  const requirementInsert = `insert into job_requirement
    (job_snapshot_id, body, quote, quote_verified, kind, origin)
    values ($1, 'PostgreSQL', 'You know PostgreSQL.', true, 'must', 'model')`;

  describe('fact versions', () => {
    test('start proposed, and may go neither to the model nor into materials', async () => {
      const version = await newFactVersion();
      assert.equal(version.status, 'proposed');
      assert.equal(version.may_send_to_model, false);
      assert.equal(version.may_use_in_materials, false);
    });

    test('get their hash from the database, whatever the caller supplies', async () => {
      const body = 'Ylläpiti laskutuspalvelua – 维护了开票服务 – 12 % fewer errors';
      const fact = await row('insert into fact default values returning id');
      const version = await row(
        `insert into fact_version (fact_id, version, body, body_sha256, source)
         values ($1, 1, $2, 'not the hash', 'manual') returning body_sha256`,
        [fact.id, body],
      );
      assert.equal(version.body_sha256, sha256(body));
    });

    test('keep their text: only status and visibility can change', async () => {
      const version = await newFactVersion();
      for (const change of [
        `body = 'Maintained every service.'`,
        `body_sha256 = 'x'`,
        `source = 'model'`,
        'version = 2',
        `fact_id = '${randomUUID()}'`,
        "created_at = now() - interval '1 day'",
      ]) {
        await assert.rejects(
          client.query(`update fact_version set ${change} where id = $1`, [version.id]),
          immutable,
          change,
        );
      }

      const confirmed = await row(
        `update fact_version
         set status = 'confirmed', may_send_to_model = true, may_use_in_materials = true
         where id = $1 returning *`,
        [version.id],
      );
      assert.equal(confirmed.status, 'confirmed');
      assert.equal(confirmed.body, version.body);
    });

    test('change by adding a new version, numbered once per fact', async () => {
      const first = await newFactVersion();
      const second = await row(
        `insert into fact_version (fact_id, version, body, source)
         values ($1, 2, 'Maintained and extended the invoice export service.', 'manual') returning *`,
        [first.fact_id],
      );
      assert.equal(second.status, 'proposed');
      await assert.rejects(
        client.query(
          `insert into fact_version (fact_id, version, body, source) values ($1, 2, 'Again.', 'manual')`,
          [first.fact_id],
        ),
        { code: '23505' },
      );
    });

    test('cannot be deleted', async () => {
      const version = await newFactVersion();
      await assert.rejects(
        client.query('delete from fact_version where id = $1', [version.id]),
        /cannot be deleted/,
      );
    });

    test('reject an empty text, an empty source and an unknown status', async () => {
      const fact = await row('insert into fact default values returning id');
      for (const [body, source, status] of [
        ['  ', 'manual', 'proposed'],
        ['Text.', '', 'proposed'],
        ['Text.', 'manual', 'approved'],
      ]) {
        await assert.rejects(
          client.query(
            'insert into fact_version (fact_id, version, body, source, status) values ($1, 1, $2, $3, $4)',
            [fact.id, body, source, status],
          ),
          { code: '23514' },
        );
      }
    });
  });

  describe('job snapshots', () => {
    test('are never updated, and the same text captured twice is stored once', async () => {
      const snapshot = await newSnapshot();
      assert.equal(snapshot.body_sha256, sha256(snapshot.body));

      const again = await client.query(
        `insert into job_snapshot (${snapshotColumns}) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [snapshot.job_id, snapshot.body, ...snapshotSource],
      );
      assert.equal(again.rowCount, 0);

      await assert.rejects(
        client.query(`update job_snapshot set source_url = 'https://example.com' where id = $1`, [
          snapshot.id,
        ]),
        immutable,
      );
      // 只有再次读到相同原文的时间可以改。
      await row('update job_snapshot set last_captured_at = now() where id = $1 returning id', [
        snapshot.id,
      ]);

      const changed = await row(
        `insert into job_snapshot (${snapshotColumns}) values ($1, $2, $3, $4, $5) returning id`,
        [snapshot.job_id, `${snapshot.body} Remote is fine.`, ...snapshotSource],
      );
      assert.notEqual(changed.id, snapshot.id);
    });

    test('can be deleted only while nothing refers to them', async () => {
      const unused = await newSnapshot();
      await row('delete from job_snapshot where id = $1 returning id', [unused.id]);

      const used = await newSnapshot();
      await client.query(requirementInsert, [used.id]);
      await assert.rejects(
        client.query('delete from job_snapshot where id = $1', [used.id]),
        foreignKey,
      );
    });

    test('are capped at 1 MiB', async () => {
      const job = await row('insert into job default values returning id');
      await assert.rejects(
        client.query(`insert into job_snapshot (${snapshotColumns}) values ($1, $2, $3, $4, $5)`, [
          job.id,
          'x'.repeat(1024 * 1024 + 1),
          ...snapshotSource,
        ]),
        { code: '23514' },
      );
    });

    test('say where the text came from, with a title and an https link', async () => {
      const job = await row('insert into job default values returning id');
      const insert = `insert into job_snapshot (${snapshotColumns}) values ($1, 'Text.', $2, $3, $4)`;
      for (const [catalogId, title, url] of [
        ['Paste', 'Engineer', 'https://example.com/1'],
        ['paste', ' ', 'https://example.com/1'],
        ['paste', 'Engineer', 'http://example.com/1'],
        ['paste', 'Engineer', 'javascript:alert(1)'],
      ]) {
        await assert.rejects(client.query(insert, [job.id, catalogId, title, url]), {
          code: '23514',
        });
      }
      await assert.rejects(
        client.query(
          `insert into job_snapshot (job_id, body, catalog_id, title) values ($1, 'Text.', 'paste', 'Engineer')`,
          [job.id],
        ),
        { code: '23502' },
      );
    });
  });

  describe('job requirements', () => {
    test('keep their content: a correction removes one and adds another', async () => {
      const snapshot = await newSnapshot();
      const requirement = await row(`${requirementInsert} returning *`, [snapshot.id]);
      for (const change of [
        `body = 'MySQL'`,
        `quote = 'You know MySQL.'`,
        'quote_verified = false',
        `kind = 'nice'`,
        `origin = 'user'`,
      ]) {
        await assert.rejects(
          client.query(`update job_requirement set ${change} where id = $1`, [requirement.id]),
          immutable,
          change,
        );
      }
      await row('update job_requirement set removed_at = now() where id = $1 returning id', [
        requirement.id,
      ]);
      await assert.rejects(
        client.query('delete from job_requirement where id = $1', [requirement.id]),
        /cannot be deleted/,
      );
    });

    test('are a must-have or a nice-to-have, from the model or the user', async () => {
      const snapshot = await newSnapshot();
      const insert = `insert into job_requirement
        (job_snapshot_id, body, quote, quote_verified, kind, origin)
        values ($1, 'PostgreSQL', '', false, $2, $3)`;
      await client.query(insert, [snapshot.id, 'nice', 'user']);
      await assert.rejects(client.query(insert, [snapshot.id, 'optional', 'user']), {
        code: '23514',
      });
      await assert.rejects(client.query(insert, [snapshot.id, 'must', 'recruiter']), {
        code: '23514',
      });
    });
  });

  describe('model calls and job summaries', () => {
    const callInsert = `insert into model_call
      (purpose, job_snapshot_id, model, started_at, duration_ms, input_tokens,
       cached_input_tokens, output_tokens, cost_usd, failure_reason)
      values ('job_summary', $1, 'some-model', now(), 1200, $2, $3, $4, $5, $6) returning *`;

    test('record the usage reported, or none, and never change', async () => {
      const snapshot = await newSnapshot();
      const ok = await row(callInsert, [snapshot.id, 3000, 1000, 800, '0.001234', null]);
      assert.equal(ok.cost_usd, '0.001234');
      // 供应商没有回答时没有用量；回答了但格式不对时有用量和失败原因。
      await row(callInsert, [snapshot.id, null, null, null, null, 'Could not reach DeepSeek.']);
      await row(callInsert, [snapshot.id, 10, 0, 5, '0', 'The answer was not JSON.']);
      for (const values of [
        [3000, null, 800, '0.1', null],
        [3000, 4000, 800, '0.1', null],
        [3000, 1000, 800, '0.1', ' '],
      ]) {
        await assert.rejects(client.query(callInsert, [snapshot.id, ...values]), {
          code: '23514',
        });
      }
      await assert.rejects(
        client.query('update model_call set cost_usd = 0 where id = $1', [ok.id]),
        immutable,
      );
      await assert.rejects(
        client.query('delete from model_call where id = $1', [ok.id]),
        /cannot be deleted/,
      );
    });

    test('a snapshot has at most one summary, which never changes', async () => {
      const snapshot = await newSnapshot();
      const call = await row(callInsert, [snapshot.id, 3000, 0, 800, '0.001', null]);
      const other = await row(callInsert, [snapshot.id, 3000, 0, 800, '0.001', null]);
      const insert = `insert into job_summary (job_snapshot_id, model_call_id, responsibilities, fields)
                      values ($1, $2, $3, $4) returning id`;
      const summary = await row(insert, [snapshot.id, call.id, '[]', '{}']);
      await assert.rejects(client.query(insert, [snapshot.id, other.id, '[]', '{}']), {
        code: '23505',
      });
      await assert.rejects(
        client.query(insert, [(await newSnapshot('Another job.')).id, other.id, '{}', '{}']),
        { code: '23514' },
      );
      await assert.rejects(
        client.query(`update job_summary set fields = '{"a": 1}' where id = $1`, [summary.id]),
        immutable,
      );
    });
  });

  describe('references to fact versions', () => {
    test('claims and applications cite fact versions by foreign key', async () => {
      const version = await newFactVersion();
      const snapshot = await newSnapshot();
      const artifact = await row(
        `insert into artifact (job_snapshot_id, kind) values ($1, 'resume') returning id`,
        [snapshot.id],
      );
      const claim = await row(
        `insert into artifact_claim (artifact_id, position, body) values ($1, 0, 'Maintains the invoice export.') returning id`,
        [artifact.id],
      );
      await client.query('insert into artifact_claim_fact values ($1, $2)', [claim.id, version.id]);
      await assert.rejects(
        client.query('insert into artifact_claim_fact values ($1, $2)', [claim.id, randomUUID()]),
        foreignKey,
      );

      const application = await row(
        `insert into application (job_snapshot_id, status) values ($1, 'to_verify') returning id`,
        [snapshot.id],
      );
      await client.query('insert into application_artifact values ($1, $2)', [
        application.id,
        artifact.id,
      ]);
      await client.query('insert into application_fact_version values ($1, $2)', [
        application.id,
        version.id,
      ]);
      await assert.rejects(
        client.query('insert into application_fact_version values ($1, $2)', [
          application.id,
          randomUUID(),
        ]),
        foreignKey,
      );
    });

    test('match evidence belongs to an outcome recorded for the same match', async () => {
      const version = await newFactVersion();
      const snapshot = await newSnapshot();
      const requirement = await row(`${requirementInsert} returning id`, [snapshot.id]);
      const match = await row(
        `insert into match (job_snapshot_id, verdict) values ($1, 'eligible') returning id`,
        [snapshot.id],
      );
      const evidence = 'insert into match_evidence values ($1, $2, $3)';
      await assert.rejects(
        client.query(evidence, [match.id, requirement.id, version.id]),
        foreignKey,
      );

      await client.query(`insert into match_requirement values ($1, $2, 'met')`, [
        match.id,
        requirement.id,
      ]);
      await client.query(evidence, [match.id, requirement.id, version.id]);
    });
  });

  test('a submitted application has a submission time, one to verify has none', async () => {
    const snapshot = await newSnapshot();
    const insert =
      'insert into application (job_snapshot_id, status, submitted_at) values ($1, $2, $3)';
    await client.query(insert, [snapshot.id, 'submitted', new Date()]);
    await client.query(insert, [snapshot.id, 'to_verify', null]);
    await assert.rejects(client.query(insert, [snapshot.id, 'submitted', null]), { code: '23514' });
    await assert.rejects(client.query(insert, [snapshot.id, 'to_verify', new Date()]), {
      code: '23514',
    });
  });

  describe('sources', () => {
    test('are unique per catalog entry and parameter', async () => {
      await client.query(`insert into source (catalog_id, param) values ('some_board', 'acme')`);
      await client.query(`insert into source (catalog_id, param) values ('some_board', 'other')`);
      await assert.rejects(
        client.query(`insert into source (catalog_id, param) values ('some_board', 'acme')`),
        { code: '23505' },
      );
      await client.query(`insert into source (catalog_id) values ('some_alert')`);
      await assert.rejects(client.query(`insert into source (catalog_id) values ('some_alert')`), {
        code: '23505',
      });
    });

    test('record a failure with its reason, never one without the other', async () => {
      const insert = `insert into source (catalog_id, param, last_failure_at, last_failure_reason)
                      values ('pair_board', $1, $2, $3)`;
      await client.query(insert, ['a', new Date(), 'HTTP 404']);
      await assert.rejects(client.query(insert, ['b', new Date(), null]), { code: '23514' });
      await assert.rejects(client.query(insert, ['c', null, 'HTTP 404']), { code: '23514' });
    });
  });

  describe('job postings', () => {
    const insert = `insert into job_posting (source_id, job_id, external_id, title, location, url)
                    values ($1, $2, $3, $4, '', $5)`;

    test('are unique per source, have a title and only link to https pages', async () => {
      const source = await row(
        `insert into source (catalog_id, param) values ('pb', 'a') returning id`,
      );
      const job = await row('insert into job default values returning id');
      const values = (externalId: string, title: string, url: string) =>
        [source.id, job.id, externalId, title, url] as unknown[];

      await client.query(insert, values('1', 'Engineer', 'https://example.com/jobs/1'));
      await assert.rejects(client.query(insert, values('1', 'Other', 'https://example.com/1')), {
        code: '23505',
      });
      for (const [title, url] of [
        [' ', 'https://example.com/jobs/2'],
        ['Engineer', 'http://example.com/jobs/2'],
        ['Engineer', 'javascript:alert(1)'],
      ]) {
        await assert.rejects(client.query(insert, values('2', title!, url!)), { code: '23514' });
      }
    });

    test('go with their source, while the job stays', async () => {
      const source = await row(
        `insert into source (catalog_id, param) values ('pb', 'b') returning id`,
      );
      const job = await row('insert into job default values returning id');
      await client.query(insert, [source.id, job.id, '1', 'Engineer', 'https://example.com/1']);
      await assert.rejects(client.query('delete from job where id = $1', [job.id]), foreignKey);

      await client.query('delete from source where id = $1', [source.id]);
      const left = await client.query('select 1 from job_posting where source_id = $1', [
        source.id,
      ]);
      assert.equal(left.rowCount, 0);
      assert.equal((await client.query('select 1 from job where id = $1', [job.id])).rowCount, 1);
    });
  });

  test('the search scope is one row, Helsinki without remote jobs by default', async () => {
    assert.deepEqual((await client.query('select area, include_remote from search_scope')).rows, [
      { area: 'helsinki', include_remote: false },
    ]);
    await assert.rejects(client.query('insert into search_scope default values'), {
      code: '23505',
    });
    await assert.rejects(client.query('insert into search_scope (singleton) values (false)'), {
      code: '23514',
    });
    await assert.rejects(client.query(`update search_scope set area = 'everywhere'`), {
      code: '23514',
    });
  });
});
