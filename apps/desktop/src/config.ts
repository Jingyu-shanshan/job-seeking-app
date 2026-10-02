const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The app's address: the server that serves its pages and its API, `JSA_APP_URL`, by default
 * the local server (`npm start`). Plain http is allowed only on this computer, since the app's
 * session cookie travels with every request.
 */
export function appUrlFrom(env: NodeJS.ProcessEnv): URL {
  const text = env.JSA_APP_URL || 'http://127.0.0.1:3000';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`JSA_APP_URL is not a valid URL: ${text}`);
  }
  const local = url.protocol === 'http:' && loopback.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error('JSA_APP_URL must be an https URL, or http on 127.0.0.1 or localhost');
  }
  if (url.username || url.password) {
    throw new Error('JSA_APP_URL must not carry a user name or password');
  }
  return new URL(url.origin);
}
