const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface RunnerConfig {
  /** The app's server, whose API the runner calls. */
  appUrl: URL;
  /** The token the user issued on the app's Runner page. */
  token: string;
}

/**
 * The runner's settings: `JSA_APP_URL` (by default the local server, `npm start`) and
 * `JSA_RUNNER_TOKEN`. The token goes with every request, so plain http is allowed only on this
 * computer.
 */
export function runnerConfig(env: NodeJS.ProcessEnv): RunnerConfig {
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
  const token = env.JSA_RUNNER_TOKEN?.trim() ?? '';
  if (!/^jsa_runner_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error(
      'Set JSA_RUNNER_TOKEN to a token from the app’s Runner page, for example in the .env file.',
    );
  }
  return { appUrl: new URL(url.origin), token };
}
