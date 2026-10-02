import { join } from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** Directory holding the built Angular app (`index.html` and assets). */
  webRoot: string;
  /** PostgreSQL connection string. Optional locally, required in production. */
  databaseUrl: string | undefined;
  /** Session signing secret. Required whenever there is a database, since that enables sign-in. */
  authSecret: string | undefined;
  /** The origin users open the app at; Better Auth's `baseURL`. */
  appUrl: string;
  /** Origins allowed to send write requests to `/api`. */
  trustedOrigins: string[];
  /** DeepSeek 的 API 密钥；没有时不能总结职位，其余功能不受影响。 */
  deepseekApiKey: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const production = env.NODE_ENV === 'production';
  const databaseUrl = loadDatabaseUrl(env);
  const appUrl = checkAppUrl(env.BETTER_AUTH_URL || undefined, production, port);
  return {
    // Railway routes traffic to 0.0.0.0:$PORT. Locally stay on loopback so the API is not
    // reachable from the network.
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port,
    // Same relative path from src/ (dev) and dist/ (build).
    webRoot: env.WEB_ROOT ?? join(import.meta.dirname, '../../web/dist/web/browser'),
    databaseUrl,
    authSecret: checkAuthSecret(env.BETTER_AUTH_SECRET || undefined, databaseUrl),
    appUrl,
    // Locally the app is opened at 127.0.0.1 or localhost, directly or through `ng serve`
    // (npm run dev:web), which proxies /api from port 4200.
    trustedOrigins: production
      ? [appUrl]
      : [
          ...new Set([
            appUrl,
            `http://127.0.0.1:${port}`,
            `http://localhost:${port}`,
            'http://localhost:4200',
          ]),
        ],
    deepseekApiKey: env.DEEPSEEK_API_KEY || undefined,
  };
}

/**
 * DATABASE_URL, checked. Migrations need only this, not the rest of the server's config.
 * Error messages never include the URL: it carries the database password.
 */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.DATABASE_URL || undefined;
  if (env.NODE_ENV !== 'production') return url;
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

function checkAppUrl(url: string | undefined, production: boolean, port: number): string {
  if (!url) {
    if (production) throw new Error('BETTER_AUTH_URL is required in production');
    return `http://127.0.0.1:${port}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`BETTER_AUTH_URL is not a valid URL: ${url}`);
  }
  // Session cookies are marked Secure only for an https URL.
  if (production && parsed.protocol !== 'https:') {
    throw new Error('BETTER_AUTH_URL must be an https URL in production');
  }
  return parsed.origin;
}

// Error messages never include the secret.
function checkAuthSecret(secret: string | undefined, databaseUrl: string | undefined) {
  if (!databaseUrl) return secret;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required with DATABASE_URL (openssl rand -base64 32)');
  }
  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)');
  }
  return secret;
}
