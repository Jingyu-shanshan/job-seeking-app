import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Unauthorized, runnerApi } from './api.ts';

const token = `jsa_runner_${'a'.repeat(43)}`;
const id = '00000000-0000-4000-8000-000000000001';

/** A fetch that answers from `answer` and records what was asked. */
function fakeApp(answer: (url: string, init: RequestInit) => Response) {
  const asked: { method: string; url: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    asked.push({
      method: init.method ?? 'GET',
      url,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer(url, init);
  };
  return { fetch: fetch as typeof globalThis.fetch, asked };
}

test('every request carries the token, to the app’s runner API', async () => {
  const app = fakeApp(() => new Response(null, { status: 204 }));
  const api = runnerApi(new URL('http://127.0.0.1:3000'), token, app.fetch);
  await api.reset();
  assert.equal(await api.claim(), null);
  assert.ok(app.asked.every((a) => a.headers.get('connection') === 'close'));
  assert.deepEqual(
    app.asked.map((a) => [a.method, a.url, a.headers.get('authorization')]),
    [
      ['POST', 'http://127.0.0.1:3000/api/runner/reset', `Bearer ${token}`],
      ['POST', 'http://127.0.0.1:3000/api/runner/tasks/claim', `Bearer ${token}`],
    ],
  );
});

test('a move answers with the fill’s status, also when the user closed it meanwhile', async () => {
  const app = fakeApp((url) =>
    Response.json(
      { status: url.endsWith('/failure') ? 'failed' : 'closed', message: 'Closed.' },
      { status: url.endsWith('/failure') ? 200 : 409 },
    ),
  );
  const api = runnerApi(new URL('https://jobs.example.com'), token, app.fetch);
  assert.deepEqual(await api.fail(id, 'No form.'), { status: 'failed', message: 'Closed.' });
  assert.deepEqual(await api.windowClosed(id), { status: 'closed', message: 'Closed.' });
  const check = { filledNow: true, blocker: null, fields: [], screenshot: 'iVBO' };
  assert.equal((await api.check(id, check)).status, 'closed');
  assert.deepEqual(app.asked[0]!.body, { message: 'No form.' });
  assert.equal(app.asked[0]!.headers.get('content-type'), 'application/json');
  assert.equal(app.asked[2]!.url, `https://jobs.example.com/api/runner/tasks/${id}/checks`);
  assert.deepEqual(app.asked[2]!.body, check);
});

test('files come as bytes', async () => {
  const app = fakeApp(() => new Response(Buffer.from('%PDF-1.7'), { status: 200 }));
  const api = runnerApi(new URL('https://jobs.example.com'), token, app.fetch);
  assert.equal((await api.file(id, id)).toString(), '%PDF-1.7');
});

test('a refused token stops the runner; other errors say what the app answered', async () => {
  const refused = runnerApi(
    new URL('https://jobs.example.com'),
    token,
    fakeApp(() => new Response(null, { status: 401 })).fetch,
  );
  await assert.rejects(refused.claim(), Unauthorized);
  await assert.rejects(refused.state(id), /Issue a new one on the app’s Runner page/);

  const broken = runnerApi(
    new URL('https://jobs.example.com'),
    token,
    fakeApp((url) =>
      url.includes('/files/')
        ? Response.json({ message: 'This fill attaches no such file.' }, { status: 404 })
        : new Response('oops', { status: 502 }),
    ).fetch,
  );
  await assert.rejects(broken.file(id, id), {
    message: 'The app answered HTTP 404: This fill attaches no such file.',
  });
  await assert.rejects(broken.claim(), { message: 'The app answered HTTP 502.' });
  await assert.rejects(broken.reset(), { message: 'The app answered HTTP 502.' });
});
