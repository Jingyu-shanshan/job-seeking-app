import type { Pool, PoolClient } from 'pg';
import { httpError } from '../http-error.ts';
/** Both individual requests and background steps take the same DB lock before checking/saving. */
export async function withModelLock<T>(
  pool: Pool,
  key: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const onError = () => {};
  client.on('error', onError);
  let locked = false;
  try {
    locked = (
      await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1,0)) as locked',
        [key],
      )
    ).rows[0]!.locked;
    if (!locked)
      throw httpError(409, 'This preparation step is already running. Wait for it to finish.');
    return await action(client);
  } finally {
    if (locked)
      await client
        .query('select pg_advisory_unlock(hashtextextended($1,0))', [key])
        .catch(() => {});
    client.off('error', onError);
    client.release();
  }
}
