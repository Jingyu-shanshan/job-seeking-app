import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthResponseSchema, ReadyResponseSchema } from '@jsa/shared';
import Fastify from 'fastify';
import { checkDatabase, createPool } from './db/pool.ts';

export interface AppOptions {
  webRoot: string;
  /** Without one the API still runs, and `/health/ready` reports the database as unavailable. */
  databaseUrl?: string;
  logger?: boolean;
}

export function buildApp({ webRoot, databaseUrl, logger = false }: AppOptions) {
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
    app.log.warn('DATABASE_URL is not set, /health/ready reports unavailable');
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

  // Without a web build (API-only dev, tests) the server still runs; `ng serve` proxies to it.
  const hasWeb = existsSync(join(webRoot, 'index.html'));
  if (hasWeb) {
    app.register(fastifyStatic, { root: webRoot });
  } else {
    app.log.warn({ webRoot }, 'no web build found, serving the API only');
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    // Angular routes have no file extension; a missing asset must stay a 404.
    if (hasWeb && request.method === 'GET' && !isApi && extname(path) === '') {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}
