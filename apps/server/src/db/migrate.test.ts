import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
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
});
