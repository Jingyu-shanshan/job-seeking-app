import { Pool } from 'pg';

/**
 * The server's connection pool. Prefer `pool.query()`: a client checked out with
 * `pool.connect()` has no error listener while you hold it, so attach one or a dropped
 * connection crashes the process.
 */
export function createPool(connectionString: string, onIdleError: (error: Error) => void): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    // Connecting wakes a suspended Neon compute, which takes a moment. The default is to wait forever.
    connectionTimeoutMillis: 10_000,
    application_name: 'jsa-server',
  });
  // Neon closes idle connections when it suspends the compute. pg-pool has already discarded
  // the client when it emits this, and the next query opens a new connection; without a
  // listener the event would crash the process.
  pool.on('error', onIdleError);
  return pool;
}

/** Resolves when the database answers a trivial query within `timeoutMs`, connecting included. */
export async function checkDatabase(pool: Pool, timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database did not answer within ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([pool.query('select 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
