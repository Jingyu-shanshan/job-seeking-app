import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postToApp } from './app-api.ts';

const appUrl = new URL('http://127.0.0.1:3000');

function fakeFetch(answer: () => Response | Promise<Response>) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    return answer();
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

test('posts JSON to the app with the app’s own origin', async () => {
  const { fetch, requests } = fakeFetch(() => Response.json({ saved: 1, newJobs: 1 }));
  const answer = await postToApp(fetch, appUrl, '/api/saved-results', { entries: [] });
  assert.deepEqual(answer, { ok: true, value: { saved: 1, newJobs: 1 } });
  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:3000/api/saved-results',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
        body: '{"entries":[]}',
      },
    },
  ]);
});

test('says what to do when the app refuses or cannot be reached', async () => {
  const cases: [() => Response | Promise<Response>, string | RegExp][] = [
    [() => Promise.reject(new TypeError('fetch failed')), /not reachable\. Start it/],
    [() => Response.json({ error: 'Unauthorized' }, { status: 401 }), /Sign in to the app/],
    [() => new Response('', { status: 413 }), /too large/],
    [
      () => Response.json({ message: 'This LinkedIn page is not a job’s page.' }, { status: 400 }),
      'This LinkedIn page is not a job’s page.',
    ],
    [() => Response.json({ error: 'Forbidden' }, { status: 403 }), 'The app answered HTTP 403.'],
    [() => new Response('<html>', { status: 502 }), 'The app answered HTTP 502.'],
  ];
  for (const [answer, message] of cases) {
    const result = await postToApp(fakeFetch(answer).fetch, appUrl, '/api/saved-pages', {});
    assert.equal(result.ok, false);
    if (!result.ok) {
      if (typeof message === 'string') assert.equal(result.message, message);
      else assert.match(result.message, message);
    }
  }
});
