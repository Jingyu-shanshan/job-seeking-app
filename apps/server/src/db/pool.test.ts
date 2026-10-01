import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { checkDatabase, createPool } from './pool.ts';

describe('with a database', needsDatabase, () => {
  let db: TestDatabase;

  before(async () => {
    db = await createTestDatabase();
  });

  after(() => db?.drop());

  test('a dropped idle connection does not crash the process, and the next query reconnects', async () => {
    const errors: Error[] = [];
    const pool = createPool(db.url, (error) => errors.push(error));
    try {
      const { rows } = await pool.query('select pg_backend_pid() as pid');
      const dropped = once(pool, 'error');

      // What Neon does to idle connections when it suspends the compute.
      const admin = new Client({ connectionString: db.url });
      await admin.connect();
      await admin.query('select pg_terminate_backend($1)', [rows[0].pid]);
      await admin.end();

      await dropped;
      assert.equal(errors.length, 1);
      await checkDatabase(pool);
      assert.notEqual(
        (await pool.query('select pg_backend_pid() as pid')).rows[0].pid,
        rows[0].pid,
      );
    } finally {
      await pool.end();
    }
  });

  test('data written before a restart is there after it', async () => {
    const first = createPool(db.url, () => {});
    const { rows } = await first.query('insert into job default values returning id');
    await first.end();

    const second = createPool(db.url, () => {});
    try {
      const found = await second.query('select id from job where id = $1', [rows[0].id]);
      assert.equal(found.rowCount, 1);
    } finally {
      await second.end();
    }
  });
});

test('checkDatabase fails when nothing listens on the port', async () => {
  const pool = createPool('postgres://postgres:postgres@127.0.0.1:1/postgres', () => {});
  try {
    await assert.rejects(checkDatabase(pool), { code: 'ECONNREFUSED' });
  } finally {
    await pool.end();
  }
});

test('checkDatabase gives up after its timeout when the server never answers', async () => {
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const pool = createPool(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, () => {});
  try {
    await assert.rejects(checkDatabase(pool, 100), /did not answer within 100 ms/);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await pool.end();
  }
});
