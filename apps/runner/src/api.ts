import type { FormCheckRequest, RunnerTask, RunnerTaskState } from '@jsa/shared';

// The app's API as the runner calls it (/api/runner, apps/server/src/runner/api.ts), with the
// runner's token. Each move on a fill answers with the fill's status now, also when the move could
// not happen because the user closed the fill meanwhile.

/** The app refused the token: it was revoked, or is not one of the app's. */
export class Unauthorized extends Error {}

export type RunnerApi = ReturnType<typeof runnerApi>;

export function runnerApi(appUrl: URL, token: string, fetch = globalThis.fetch) {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(new URL(`/api/runner${path}`, appUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        // A new connection for each request. Node 26.7's fetch stalls for seconds when it reuses a
        // connection that sat idle (seen 2026-10-07; Node 22 does not), and the runner asks every
        // few seconds, so it would always reuse one.
        connection: 'close',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new Unauthorized(
        'The app refused the runner’s token. Issue a new one on the app’s Runner page.',
      );
    }
    return response;
  }

  async function expect<T>(response: Response, ...ok: number[]): Promise<T> {
    if (ok.includes(response.status)) return (await response.json()) as T;
    let message = '';
    try {
      message = ((await response.json()) as { message?: string }).message ?? '';
    } catch {
      // Not the app's JSON error.
    }
    throw new Error(`The app answered HTTP ${response.status}${message ? `: ${message}` : '.'}`);
  }

  const move = async (id: string, what: string, body?: unknown) =>
    expect<RunnerTaskState>(await call('POST', `/tasks/${id}/${what}`, body), 200, 409);

  return {
    /** This runner has no windows open: the fills it had open have ended. */
    async reset(): Promise<void> {
      const response = await call('POST', '/reset');
      if (response.status !== 204) await expect(response, 204);
    },
    /** The next fill the user started, or null when there is none. */
    async claim(): Promise<RunnerTask | null> {
      const response = await call('POST', '/tasks/claim');
      if (response.status === 204) return null;
      return expect<RunnerTask>(response, 200);
    },
    async state(id: string): Promise<RunnerTaskState> {
      return expect<RunnerTaskState>(await call('GET', `/tasks/${id}`), 200);
    },
    /** A PDF the fill attaches. */
    async file(id: string, pdfId: string): Promise<Buffer> {
      const response = await call('GET', `/tasks/${id}/files/${pdfId}`);
      if (response.status !== 200) await expect(response, 200);
      return Buffer.from(await response.arrayBuffer());
    },
    check: (id: string, check: FormCheckRequest) => move(id, 'checks', check),
    fail: (id: string, message: string) => move(id, 'failure', { message }),
    windowClosed: (id: string) => move(id, 'window-closed'),
  };
}
