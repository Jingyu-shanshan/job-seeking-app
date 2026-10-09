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
    const fact = await row(`insert into fact (kind) values ('experience') returning id`);
    return row(
      `insert into fact_version (fact_id, version, body, source) values ($1, 1, $2, 'manual') returning *`,
      [fact.id, body],
    );
  }

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
      const fact = await row(`insert into fact (kind) values ('experience') returning id`);
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

    test('belong to a fact of a known kind', async () => {
      await row(`insert into fact (kind) values ('skill') returning id`);
      await assert.rejects(client.query(`insert into fact (kind) values ('hobby')`), {
        code: '23514',
      });
      await assert.rejects(client.query('insert into fact default values'), { code: '23502' });
    });

    test('reject an empty text, an empty source and an unknown status', async () => {
      const fact = await row(`insert into fact (kind) values ('experience') returning id`);
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

  async function newArtifact(snapshotId: string, kind = 'resume') {
    const call = await row(
      `insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms)
       values ('draft', $1, 'some-model', now(), 900) returning id`,
      [snapshotId],
    );
    return row(
      `insert into artifact (job_snapshot_id, kind, model_call_id)
       values ($1, $2, $3) returning id, model_call_id`,
      [snapshotId, kind, call.id],
    );
  }

  const claimInsert = `insert into artifact_claim
    (artifact_id, position, body, section, block, line, about, quote)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`;
  const resumeLine = ['Maintains the invoice export.', 'experience', 0, 'bullet', 'me', null];
  const citeInsert =
    'insert into artifact_claim_fact (artifact_claim_id, artifact_id, fact_version_id) values ($1, $2, $3)';

  describe('drafts', () => {
    test('come from one model call each', async () => {
      const snapshot = await newSnapshot();
      const artifact = await newArtifact(snapshot.id);
      const insert =
        'insert into artifact (job_snapshot_id, kind, model_call_id) values ($1, $2, $3)';
      await assert.rejects(client.query(insert, [snapshot.id, 'resume', null]), { code: '23502' });
      await assert.rejects(client.query(insert, [snapshot.id, 'resume', artifact.model_call_id]), {
        code: '23505',
      });
    });

    test('place each statement, and only statements of a letter are about anything but the user', async () => {
      const snapshot = await newSnapshot();
      const artifact = await newArtifact(snapshot.id);
      let position = 0;
      const ok = (...values: unknown[]) =>
        client.query(claimInsert, [artifact.id, position++, ...values]);
      await ok('Backend developer', 'headline', 0, 'sentence', 'me', null);
      await ok('Acme Oy, 2021', 'experience', 2, 'title', 'me', null);
      await ok('I am applying.', 'letter', 1, 'sentence', 'other', null);
      await ok('You build APIs.', 'letter', 1, 'sentence', 'job', 'We build APIs.');
      for (const values of [
        ['x', 'headline', 0, 'title', 'me', null],
        ['x', 'experience', 0, 'sentence', 'me', null],
        ['x', 'summary', 0, 'sentence', 'job', 'We build APIs.'],
        ['x', 'letter', 0, 'sentence', 'me', 'A quote on a statement about the user.'],
        ['x', 'letter', -1, 'sentence', 'me', null],
        ['x', 'letter', 0, 'sentence', 'someone', null],
        ['x'.repeat(2001), 'letter', 0, 'sentence', 'other', null],
        [' ', 'letter', 0, 'sentence', 'other', null],
      ]) {
        await assert.rejects(ok(...values), { code: '23514' }, JSON.stringify(values));
      }
    });

    test('cite only fact versions that were sent with the same draft', async () => {
      const sent = await newFactVersion();
      const notSent = await newFactVersion('Ran the on-call rota.');
      const snapshot = await newSnapshot();
      const artifact = await newArtifact(snapshot.id);
      const other = await newArtifact(snapshot.id, 'cover_letter');
      await client.query('insert into artifact_fact values ($1, $2)', [artifact.id, sent.id]);
      await client.query('insert into artifact_fact values ($1, $2)', [other.id, notSent.id]);
      const claim = await row(`${claimInsert} returning id`, [artifact.id, 0, ...resumeLine]);
      await client.query(citeInsert, [claim.id, artifact.id, sent.id]);
      await assert.rejects(
        client.query(citeInsert, [claim.id, artifact.id, notSent.id]),
        foreignKey,
      );
      // The claim belongs to the draft named with it.
      await assert.rejects(client.query(citeInsert, [claim.id, other.id, notSent.id]), foreignKey);
    });

    test('never change', async () => {
      const version = await newFactVersion();
      const snapshot = await newSnapshot();
      const artifact = await newArtifact(snapshot.id);
      await client.query('insert into artifact_fact values ($1, $2)', [artifact.id, version.id]);
      const claim = await row(`${claimInsert} returning id`, [artifact.id, 0, ...resumeLine]);
      await client.query(citeInsert, [claim.id, artifact.id, version.id]);

      await assert.rejects(
        client.query(`update artifact set kind = 'cover_letter' where id = $1`, [artifact.id]),
        immutable,
      );
      await assert.rejects(
        client.query(`update artifact_claim set body = 'Ran everything.' where id = $1`, [
          claim.id,
        ]),
        immutable,
      );
      await assert.rejects(client.query('delete from artifact_claim where id = $1', [claim.id]), {
        message: /cannot be deleted/,
      });
      for (const change of [
        'update artifact_fact set fact_version_id = fact_version_id',
        'delete from artifact_fact',
        'update artifact_claim_fact set fact_version_id = fact_version_id',
        'delete from artifact_claim_fact',
      ]) {
        await assert.rejects(client.query(`${change} where artifact_id = $1`, [artifact.id]), {
          message: /cannot be changed or deleted/,
        });
      }
    });
  });

  describe('reviews and PDFs', () => {
    const editInsert = `insert into artifact_claim_edit (artifact_id, artifact_claim_id, body, included)
      values ($1, $2, $3, $4)`;
    const pdfInsert = `insert into document_pdf (artifact_id, body, file_name, pages, text)
      values ($1, $2, 'Test Person - Resume', $3, 'Test Person')`;

    async function newClaim(artifactId?: string) {
      const artifact = artifactId ?? (await newArtifact((await newSnapshot()).id)).id;
      const claim = await row(`${claimInsert} returning id`, [artifact, 0, ...resumeLine]);
      return { artifact, claim: claim.id as string };
    }

    test('the user’s details are one row, empty at first, with at most three links', async () => {
      assert.deepEqual(
        (await client.query('select name, email, phone, location, links from profile')).rows,
        [{ name: '', email: '', phone: '', location: '', links: [] }],
      );
      await assert.rejects(client.query('insert into profile default values'), { code: '23505' });
      await assert.rejects(client.query('insert into profile (singleton) values (false)'), {
        code: '23514',
      });
      await assert.rejects(client.query(`update profile set links = '{a,b,c,d}'`), {
        code: '23514',
      });
    });

    test('an edit is of a statement of the same draft, has text, and never changes', async () => {
      const { artifact, claim } = await newClaim();
      const other = await newClaim();
      const edit = await row(`${editInsert} returning id`, [
        artifact,
        claim,
        'Kept it short.',
        true,
      ]);
      await assert.rejects(
        client.query(editInsert, [other.artifact, claim, 'x', true]),
        foreignKey,
      );
      for (const body of ['  ', 'x'.repeat(2001)]) {
        await assert.rejects(client.query(editInsert, [artifact, claim, body, true]), {
          code: '23514',
        });
      }
      await assert.rejects(
        client.query(`update artifact_claim_edit set body = 'Changed.' where id = $1`, [edit.id]),
        immutable,
      );
      await assert.rejects(
        client.query('delete from artifact_claim_edit where id = $1', [edit.id]),
        {
          message: /cannot be deleted/,
        },
      );
    });

    test('a kept PDF gets its hash from the database, is capped at 2 MiB and kept once per draft', async () => {
      const { artifact } = await newClaim();
      const body = Buffer.from('%PDF-1.4 made up');
      const pdf = await row(
        `insert into document_pdf (artifact_id, body, body_sha256, file_name, pages, text)
         values ($1, $2, 'not the hash', 'Test Person - Resume', 1, 'Test Person') returning *`,
        [artifact, body],
      );
      assert.equal(pdf.body_sha256, createHash('sha256').update(body).digest('hex'));
      await assert.rejects(client.query(pdfInsert, [artifact, body, 1]), { code: '23505' });
      for (const [bytes, pages] of [
        [Buffer.alloc(0), 1],
        [Buffer.alloc(2 * 1024 * 1024 + 1), 1],
        [Buffer.from('%PDF other'), 0],
        [Buffer.from('%PDF other'), 21],
      ] as const) {
        await assert.rejects(client.query(pdfInsert, [artifact, bytes, pages]), { code: '23514' });
      }
      await assert.rejects(
        client.query(`update document_pdf set file_name = 'Other' where id = $1`, [pdf.id]),
        immutable,
      );
      await assert.rejects(client.query('delete from document_pdf where id = $1', [pdf.id]), {
        message: /cannot be deleted/,
      });
    });

    test('a kept PDF lists statements of its draft, each with an edit of that statement', async () => {
      const { artifact, claim } = await newClaim();
      const second = await row(`${claimInsert} returning id`, [artifact, 1, ...resumeLine]);
      const other = await newClaim();
      const edit = await row(`${editInsert} returning id`, [
        artifact,
        claim,
        'Kept it short.',
        true,
      ]);
      const pdf = await row(`${pdfInsert} returning id`, [artifact, Buffer.from('%PDF a'), 1]);
      const insert = `insert into document_pdf_statement
        (document_pdf_id, artifact_id, artifact_claim_id, artifact_claim_edit_id) values ($1, $2, $3, $4)`;
      await client.query(insert, [pdf.id, artifact, claim, edit.id]);
      await client.query(insert, [pdf.id, artifact, second.id, null]);
      await assert.rejects(
        client.query(insert, [pdf.id, other.artifact, other.claim, null]),
        foreignKey,
      );
      await assert.rejects(client.query(insert, [pdf.id, artifact, other.claim, null]), foreignKey);
      const third = await row(`${claimInsert} returning id`, [artifact, 2, ...resumeLine]);
      // The edit is of another statement.
      await assert.rejects(client.query(insert, [pdf.id, artifact, third.id, edit.id]), foreignKey);
      for (const change of [
        'update document_pdf_statement set artifact_claim_edit_id = null',
        'delete from document_pdf_statement',
      ]) {
        await assert.rejects(client.query(`${change} where document_pdf_id = $1`, [pdf.id]), {
          message: /cannot be changed or deleted/,
        });
      }
    });
  });

  describe('references to fact versions', () => {
    test('claims and applications cite fact versions by foreign key', async () => {
      const version = await newFactVersion();
      const snapshot = await newSnapshot();
      const artifact = await newArtifact(snapshot.id);
      await client.query('insert into artifact_fact values ($1, $2)', [artifact.id, version.id]);
      const claim = await row(`${claimInsert} returning id`, [artifact.id, 0, ...resumeLine]);
      await client.query(citeInsert, [claim.id, artifact.id, version.id]);
      await assert.rejects(
        client.query(citeInsert, [claim.id, artifact.id, randomUUID()]),
        foreignKey,
      );

      const application = await row(
        `insert into application (job_id, job_snapshot_id, status, method)
         select job_id, id, 'to_verify', 'runner' from job_snapshot where id = $1 returning id`,
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
  });

  describe('matches', () => {
    async function newMatch(snapshotId: string) {
      const call = await row(
        `insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms)
         values ('match', $1, 'some-model', now(), 900) returning id`,
        [snapshotId],
      );
      return row(
        `insert into match (job_snapshot_id, verdict, model_call_id)
         values ($1, 'eligible', $2) returning id, model_call_id`,
        [snapshotId, call.id],
      );
    }

    const outcomeInsert = `insert into match_requirement (match_id, job_requirement_id, outcome, note)
      values ($1, $2, 'met', $3)`;

    test('come from one model call each', async () => {
      const snapshot = await newSnapshot();
      const match = await newMatch(snapshot.id);
      const insert =
        'insert into match (job_snapshot_id, verdict, model_call_id) values ($1, $2, $3)';
      await assert.rejects(client.query(insert, [snapshot.id, 'eligible', null]), {
        code: '23502',
      });
      await assert.rejects(client.query(insert, [snapshot.id, 'eligible', match.model_call_id]), {
        code: '23505',
      });
    });

    test('cite only fact versions that were sent, for an outcome of the same match', async () => {
      const sent = await newFactVersion();
      const notSent = await newFactVersion('Ran the on-call rota.');
      const snapshot = await newSnapshot();
      const requirement = await row(`${requirementInsert} returning id`, [snapshot.id]);
      const match = await newMatch(snapshot.id);
      const evidence = 'insert into match_evidence values ($1, $2, $3)';
      await client.query('insert into match_fact values ($1, $2)', [match.id, sent.id]);
      await assert.rejects(client.query(evidence, [match.id, requirement.id, sent.id]), foreignKey);

      await client.query(outcomeInsert, [match.id, requirement.id, 'Says so.']);
      await client.query(evidence, [match.id, requirement.id, sent.id]);
      await assert.rejects(
        client.query(evidence, [match.id, requirement.id, notSent.id]),
        foreignKey,
      );
    });

    test('keep a short note and never change', async () => {
      const version = await newFactVersion();
      const snapshot = await newSnapshot();
      const requirement = await row(`${requirementInsert} returning id`, [snapshot.id]);
      const match = await newMatch(snapshot.id);
      await assert.rejects(
        client.query(outcomeInsert, [match.id, requirement.id, 'x'.repeat(1001)]),
        { code: '23514' },
      );
      await client.query(outcomeInsert, [match.id, requirement.id, 'Says so.']);
      await client.query('insert into match_fact values ($1, $2)', [match.id, version.id]);
      await client.query('insert into match_evidence values ($1, $2, $3)', [
        match.id,
        requirement.id,
        version.id,
      ]);

      await assert.rejects(
        client.query(`update match set verdict = 'ineligible' where id = $1`, [match.id]),
        immutable,
      );
      await assert.rejects(client.query('delete from match where id = $1', [match.id]), {
        message: /cannot be deleted/,
      });
      for (const change of [
        `update match_requirement set outcome = 'unmet'`,
        'delete from match_requirement',
        'delete from match_evidence',
        'update match_fact set fact_version_id = fact_version_id',
        'delete from match_fact',
      ]) {
        await assert.rejects(client.query(`${change} where match_id = $1`, [match.id]), {
          message: /cannot be changed or deleted/,
        });
      }
    });
  });

  test('a submitted application has a submission time, one to verify has none', async () => {
    const insert = `insert into application (job_id, job_snapshot_id, status, submitted_at, method)
       select job_id, id, $2, $3, 'runner' from job_snapshot where id = $1`;
    await client.query(insert, [(await newSnapshot()).id, 'submitted', new Date()]);
    await client.query(insert, [(await newSnapshot()).id, 'to_verify', null]);
    await client.query(insert, [(await newSnapshot()).id, 'not_submitted', null]);
    const snapshot = await newSnapshot();
    await assert.rejects(client.query(insert, [snapshot.id, 'submitted', null]), { code: '23514' });
    await assert.rejects(client.query(insert, [snapshot.id, 'to_verify', new Date()]), {
      code: '23514',
    });
    await assert.rejects(client.query(insert, [snapshot.id, 'not_submitted', new Date()]), {
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

  test('the criteria are one row: a hard location in Helsinki, the must-haves a preference', async () => {
    assert.deepEqual(
      (
        await client.query(
          `select area, include_remote, location_strength, location_if_unknown, title_strength,
             title_words, must_have_strength from job_criteria`,
        )
      ).rows,
      [
        {
          area: 'helsinki',
          include_remote: false,
          location_strength: 'hard',
          location_if_unknown: 'to_confirm',
          title_strength: 'off',
          title_words: [],
          must_have_strength: 'preference',
        },
      ],
    );
    await assert.rejects(client.query('insert into job_criteria default values'), {
      code: '23505',
    });
    await assert.rejects(client.query('insert into job_criteria (singleton) values (false)'), {
      code: '23514',
    });
    for (const change of [
      `area = 'everywhere'`,
      `title_strength = 'must'`,
      `location_if_unknown = 'ignore'`,
      // A criterion in use needs something to compare with.
      `title_strength = 'hard'`,
      `language_strength = 'preference'`,
      `employment_strength = 'hard', employment_types = '{weekly}'`,
    ]) {
      await assert.rejects(
        client.query(`update job_criteria set ${change}`),
        { code: '23514' },
        change,
      );
    }
    await client.query(
      `update job_criteria set title_strength = 'hard', title_words = '{backend}'`,
    );
  });
});
