import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { migrate, migrationsDir } from './migrate.ts';

const quiet = () => {};

describe('migrations', needsDatabase, () => {
  let db: TestDatabase;

  before(async () => {
    db = await createTestDatabase({ migrated: false });
  });

  after(() => db?.drop());

  test('an empty database migrates, and running again applies nothing', async () => {
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.slice(0, -'.sql'.length))
      .sort();
    assert.ok(files.length > 0);

    const first = await migrate(db.url, quiet);
    assert.deepEqual(
      first.map((migration) => migration.name),
      files,
    );

    assert.deepEqual(await migrate(db.url, quiet), []);
  });

  test('adding draft language preserves existing immutable English content', async () => {
    const oldDb = await createTestDatabase({ migrated: false });
    const pool = new Pool({ connectionString: oldDb.url });
    try {
      const earlier = readdirSync(migrationsDir).filter(
        (file) => file.endsWith('.sql') && file < '1793232000000_draft-language.sql',
      ).length;
      await runner({
        databaseUrl: oldDb.url,
        dir: migrationsDir,
        direction: 'up',
        count: earlier,
        migrationsTable: 'pgmigrations',
        log: quiet,
      });
      const {
        rows: [old],
      } = await pool.query(`with j as (
        insert into job default values returning id
      ), s as (
        insert into job_snapshot (job_id, body, catalog_id, title, source_url)
        select id, 'Example job text.', 'paste', 'Engineer', 'https://example.com/jobs/old' from j returning id
      ), c as (
        insert into model_call (purpose, job_snapshot_id, model, started_at, duration_ms)
        select 'draft', id, 'test-model', now(), 900 from s returning id, job_snapshot_id
      ), a as (
        insert into artifact (job_snapshot_id, kind, model_call_id)
        select job_snapshot_id, 'resume', id from c returning id
      ) insert into artifact_claim (artifact_id, position, body, section, block, line, about)
        select id, 0, 'Built an invoice API.', 'summary', 0, 'sentence', 'me' from a returning artifact_id, body`);
      await migrate(oldDb.url, quiet);
      const {
        rows: [restored],
      } = await pool.query(
        `select a.language, c.body from artifact a
        join artifact_claim c on c.artifact_id = a.id where a.id = $1`,
        [old.artifact_id],
      );
      assert.deepEqual(restored, { language: 'en', body: 'Built an invoice API.' });
    } finally {
      await pool.end();
      await oldDb.drop();
    }
  });

  test('a later migration failure rolls back earlier files and keeps existing data', async () => {
    const failedDb = await createTestDatabase({ migrated: false });
    const pool = new Pool({ connectionString: failedDb.url });
    try {
      // The auth migration fails after the initial schema has run.
      await pool.query('create table "user" (id text primary key)');
      await pool.query('insert into "user" values ($1)', ['existing-test-data']);

      await assert.rejects(migrate(failedDb.url, quiet), /relation "user" already exists/);
      assert.deepEqual((await pool.query('select id from "user"')).rows, [
        { id: 'existing-test-data' },
      ]);
      assert.equal(
        (await pool.query("select to_regclass('public.fact') as fact")).rows[0].fact,
        null,
      );
      assert.equal((await pool.query('select name from pgmigrations')).rowCount, 0);
    } finally {
      await pool.end();
      await failedDb.drop();
    }
  });
});
