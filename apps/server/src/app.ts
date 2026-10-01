import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthResponseSchema, ReadyResponseSchema } from '@jsa/shared';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify from 'fastify';
import { type Auth, createAuth } from './auth.ts';
import type { Config } from './config.ts';
import { checkDatabase, createPool } from './db/pool.ts';

export type AppOptions = Pick<Config, 'webRoot' | 'appUrl' | 'trustedOrigins'> &
  Partial<Pick<Config, 'databaseUrl' | 'authSecret'>> & {
    logger?: boolean;
  };

// Requests that cannot change anything. Every other method is a write.
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function buildApp({
  webRoot,
  databaseUrl,
  authSecret,
  appUrl,
  trustedOrigins,
  logger = false,
}: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
  }));

  const pool = databaseUrl
    ? createPool(databaseUrl, (err) => app.log.warn({ err }, 'idle database connection closed'))
    : undefined;
  if (pool) {
    app.addHook('onClose', () => pool.end());
  } else {
    app.log.warn(
      'DATABASE_URL is not set, /health/ready reports unavailable and nobody can sign in',
    );
  }

  app.get(
    '/health/ready',
    { schema: { response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } },
    async (request, reply) => {
      if (pool) {
        try {
          await checkDatabase(pool);
          return { status: 'ok' as const };
        } catch (err) {
          request.log.warn({ err }, 'database not ready');
        }
      }
      return reply.code(503).send({ status: 'unavailable' as const });
    },
  );

  let auth: Auth | undefined;
  if (pool) {
    if (!authSecret) throw new Error('authSecret is required with databaseUrl');
    auth = createAuth({
      pool,
      secret: authSecret,
      appUrl,
      trustedOrigins,
      log: (level, message, ...args) =>
        args.length ? app.log[level]({ args }, message) : app.log[level](message),
    });
    const handler = auth.handler;
    // Better Auth's endpoints (sign-in, sign-out, get-session, ...), passed through as a Fetch request.
    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      async handler(request, reply) {
        const response = await handler(
          new Request(new URL(request.url, appUrl), {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          }),
        );
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(response.body ? await response.text() : null);
      },
    });
  }

  // Runs for every request under /api, also ones that match no route, so a route added later is
  // private unless it lives under /api/auth.
  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request.url);
    if (!isApi(path)) return;
    // Cross-site writes are refused before anything else, sign-in included. Browsers send
    // Origin with every non-GET fetch, so a missing one is refused as well.
    if (
      !safeMethods.has(request.method) &&
      !trustedOrigins.includes(request.headers.origin ?? '')
    ) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (path.startsWith('/api/auth/')) return;
    const session = await auth?.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });
  });

  // Without a web build (API-only dev, tests) the server still runs; `ng serve` proxies to it.
  const hasWeb = existsSync(join(webRoot, 'index.html'));
  if (hasWeb) {
    app.register(fastifyStatic, { root: webRoot });
  } else {
    app.log.warn({ webRoot }, 'no web build found, serving the API only');
  }

  app.setNotFoundHandler((request, reply) => {
    const path = pathOf(request.url);
    // Angular routes have no file extension; a missing asset must stay a 404.
    if (hasWeb && request.method === 'GET' && !isApi(path) && extname(path) === '') {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}

function pathOf(url: string) {
  return url.split('?', 1)[0] ?? '';
}

function isApi(path: string) {
  return path === '/api' || path.startsWith('/api/');
}
