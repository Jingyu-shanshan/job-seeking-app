import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthResponseSchema } from '@jsa/shared';
import Fastify from 'fastify';

export interface AppOptions {
  webRoot: string;
  logger?: boolean;
}

export function buildApp({ webRoot, logger = false }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
  }));

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
