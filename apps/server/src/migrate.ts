// Applies pending migrations to DATABASE_URL. Runs as its own process (Railway pre-deploy,
// `npm run db:migrate`), never at server start or per request.
import { loadDatabaseUrl } from './config.ts';
import { migrate } from './db/migrate.ts';

const databaseUrl = loadDatabaseUrl();
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
await migrate(databaseUrl);
