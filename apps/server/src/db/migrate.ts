import { join } from 'node:path';
import { runner } from 'node-pg-migrate';

/** Versioned SQL files. Never edit one that has been applied anywhere; add a new file instead. */
export const migrationsDir = join(import.meta.dirname, '../../migrations');

/**
 * Applies every pending migration in one transaction and returns the ones it applied. Running
 * it again applies nothing; an advisory lock makes a concurrent second run fail instead of
 * applying twice.
 */
export function migrate(databaseUrl: string, log: (message: string) => void = console.log) {
  return runner({
    databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    log,
  });
}
