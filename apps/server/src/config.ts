import { join } from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** Directory holding the built Angular app (`index.html` and assets). */
  webRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return {
    // Railway routes traffic to 0.0.0.0:$PORT. Locally stay on loopback so the API is not
    // reachable from the network.
    host: env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port,
    // Same relative path from src/ (dev) and dist/ (build).
    webRoot: env.WEB_ROOT ?? join(import.meta.dirname, '../../web/dist/web/browser'),
  };
}
