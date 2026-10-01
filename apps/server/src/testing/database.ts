import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { migrate } from '../db/migrate.ts';

// Data-layer tests run against a real PostgreSQL server, never a mock. TEST_DATABASE_URL points
// at a database on a server where the role may create databases, e.g. the `postgres` database
// of the local container. Each test file gets its own throwaway database there.
const adminUrl = process.env.TEST_DATABASE_URL || undefined;

if (!adminUrl && process.env.CI) {
  throw new Error('TEST_DATABASE_URL must be set in CI, the database tests may not be skipped');
}

/** `describe`/`test` options: skips the database tests locally when no server is configured. */
export const needsDatabase = { skip: adminUrl ? false : 'TEST_DATABASE_URL is not set' };

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/** Creates an empty database, migrated unless `migrated` is false. */
export async function createTestDatabase({ migrated = true } = {}): Promise<TestDatabase> {
  if (!adminUrl) throw new Error('TEST_DATABASE_URL is not set');
  const name = `jsa_test_${randomUUID().replaceAll('-', '')}`;
  await asAdmin(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  if (migrated) await migrate(url.href, () => {});
  return { url: url.href, drop: () => asAdmin(`drop database if exists ${name} with (force)`) };
}

async function asAdmin(sql: string) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
