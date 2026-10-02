import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
import { greenhouseBoard } from './greenhouse.ts';

const failsWith = (fetch: typeof globalThis.fetch, message: string, board = 'acme') =>
  assert.rejects(greenhouseBoard(board, fetch), { name: 'Error', message });

test('lists a board’s jobs with the fields the app keeps', async () => {
  const { fetch, requested } = fakeGreenhouse({
    acme: [
      { id: 11, title: '  Backend Engineer ', location: 'Berlin, Germany; Helsinki, Finland' },
      { id: 12, title: 'Designer', location: '', company_name: '' },
    ],
  });
  assert.deepEqual(await greenhouseBoard('Acme', fetch), [
    {
      externalId: '11',
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Berlin, Germany; Helsinki, Finland',
      url: 'https://job-boards.greenhouse.io/acme/jobs/11',
      publishedAt: '2026-09-01T10:00:00-04:00',
    },
    {
      externalId: '12',
      title: 'Designer',
      company: null,
      location: '',
      url: 'https://job-boards.greenhouse.io/acme/jobs/12',
      publishedAt: '2026-09-01T10:00:00-04:00',
    },
  ]);
  // Without ?content=true: the job text is read in T05, not here.
  assert.deepEqual(requested, ['https://boards-api.greenhouse.io/v1/boards/Acme/jobs']);
});

test('keeps a company’s own https careers page, and links the board page instead of anything else', async () => {
  const { fetch } = fakeGreenhouse({
    acme: [
      { id: 1, absolute_url: 'https://careers.example.com/jobs/?gh_jid=1' },
      { id: 2, absolute_url: 'javascript:alert(1)' },
      { id: 3, absolute_url: 'http://careers.example.com/jobs/3' },
    ],
  });
  const urls = (await greenhouseBoard('acme', fetch)).map((p) => p.url);
  assert.deepEqual(urls, [
    'https://careers.example.com/jobs/?gh_jid=1',
    'https://job-boards.greenhouse.io/acme/jobs/2',
    'https://job-boards.greenhouse.io/acme/jobs/3',
  ]);
});

test('accepts the missing fields Greenhouse may leave out', async () => {
  const fetch = (async () =>
    Response.json({
      jobs: [{ id: 5, title: 'Engineer', location: null, absolute_url: null }],
    })) as typeof globalThis.fetch;
  const [posting] = await greenhouseBoard('acme', fetch);
  assert.deepEqual(posting, {
    externalId: '5',
    title: 'Engineer',
    company: null,
    location: '',
    url: 'https://job-boards.greenhouse.io/acme/jobs/5',
    publishedAt: null,
  });
});

test('says plainly why a board could not be read', async () => {
  await failsWith(fakeGreenhouse({}).fetch, 'Greenhouse has no job board called nope.', 'nope');
  await failsWith(
    fakeGreenhouse({ acme: 503 }).fetch,
    'boards-api.greenhouse.io answered HTTP 503.',
  );
  await failsWith(
    fakeGreenhouse({ acme: async () => new Response('<html>maintenance</html>') }).fetch,
    'The answer from boards-api.greenhouse.io is not JSON.',
  );
  for (const body of [
    { jobs: 'none' },
    { jobs: [{ id: 'x', title: 'A' }] },
    { jobs: [{ id: 1 }] },
  ]) {
    await failsWith(
      fakeGreenhouse({ acme: async () => Response.json(body) }).fetch,
      'Greenhouse answered with something other than a list of jobs.',
    );
  }
  await failsWith(
    (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch,
    'Could not reach boards-api.greenhouse.io.',
  );
});

test('stops reading an answer larger than 20 MB', async () => {
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(0x20);
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  await failsWith(
    (async () => new Response(endless)) as typeof globalThis.fetch,
    'The answer from boards-api.greenhouse.io is larger than 20 MB.',
  );
  assert.ok(sent < 25, `read ${sent} MB`);
});
