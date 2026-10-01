import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

export interface AuthOptions {
  pool: Pool;
  secret: string;
  /** The origin users open the app at. Cookies are Secure when it is https. */
  appUrl: string;
  trustedOrigins: string[];
  /** Where Better Auth's own messages go; the console when omitted. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) => void;
}

/**
 * Better Auth with email and password sign-in on the server's pool. Public sign-up is always
 * disabled; the one account is created by `npm run auth:create-account`, which is the only
 * caller that passes `allowSignUp`.
 */
export function createAuth(
  { pool, secret, appUrl, trustedOrigins, log }: AuthOptions,
  { allowSignUp = false } = {},
) {
  return betterAuth({
    database: pool,
    secret,
    baseURL: appUrl,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp,
      // Creating the account must not also create a session.
      autoSignIn: false,
    },
    telemetry: { enabled: false },
    ...(log ? { logger: { log } } : {}),
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface NewAccount {
  email: string;
  name: string;
  password: string;
}

/** Creates the app's one account, and refuses when there is one already. */
export async function createAccount(options: AuthOptions, account: NewAccount): Promise<void> {
  const { rows } = await options.pool.query<{ exists: boolean }>(
    'select exists (select from "user") as exists',
  );
  if (rows[0]?.exists) throw new Error('An account exists already; the app has a single user');
  await createAuth(options, { allowSignUp: true }).api.signUpEmail({ body: account });
}
