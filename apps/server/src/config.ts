import { join } from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** Directory holding the built Angular app (`index.html` and assets). */
  webRoot: string;
  /** PostgreSQL connection string. Optional locally, required in production. */
  databaseUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const production = env.NODE_ENV === 'production';
  return {
    // Railway routes traffic to 0.0.0.0:$PORT. Locally stay on loopback so the API is not
    // reachable from the network.
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port,
    // Same relative path from src/ (dev) and dist/ (build).
    webRoot: env.WEB_ROOT ?? join(import.meta.dirname, '../../web/dist/web/browser'),
    databaseUrl: checkDatabaseUrl(env.DATABASE_URL || undefined, production),
  };
}

// Error messages never include the URL: it carries the database password.
function checkDatabaseUrl(url: string | undefined, production: boolean): string | undefined {
  if (!production) return url;
  if (!url) throw new Error('DATABASE_URL is required in production');
  let sslmode: string | null;
  try {
    sslmode = new URL(url).searchParams.get('sslmode');
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  // pg treats sslmode=require as verify-full today, but its next major version switches to the
  // libpq meaning, which skips the certificate check. Ask for verification explicitly.
  if (sslmode !== 'verify-full') {
    throw new Error('DATABASE_URL must set sslmode=verify-full in production');
  }
  return url;
}
