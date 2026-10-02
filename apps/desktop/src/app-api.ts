export type Answer<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Sends a save to the app's API. `fetch` carries the app's session cookie (the app pane's
 * session), never anything of the built-in browser's. Writes need the app's own Origin (the
 * server refuses others), which the main process may set, unlike a page.
 */
export async function postToApp<T>(
  fetch: typeof globalThis.fetch,
  appUrl: URL,
  path: string,
  body: unknown,
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(new URL(path, appUrl).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl.origin },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      message: `The app at ${appUrl.origin} is not reachable. Start it (npm start), then save again.`,
    };
  }
  if (response.ok) return { ok: true, value: (await response.json()) as T };
  if (response.status === 401) {
    return { ok: false, message: 'Sign in to the app on the left first, then save again.' };
  }
  if (response.status === 413) {
    return {
      ok: false,
      message: 'The page is too large to save. Select only the job’s text, then save again.',
    };
  }
  let message = '';
  try {
    const answer: unknown = await response.json();
    if (typeof answer === 'object' && answer !== null && 'message' in answer) {
      message = String(answer.message);
    }
  } catch {
    // Not JSON: the status says enough.
  }
  return {
    ok: false,
    message:
      response.status === 400 && message ? message : `The app answered HTTP ${response.status}.`,
  };
}
