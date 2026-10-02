import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeAshby } from '../testing/ashby.ts';
import { ashbyBoard } from './ashby.ts';

const failsWith = (fetch: typeof globalThis.fetch, message: string, board = 'acme') =>
  assert.rejects(ashbyBoard.listJobs(board, fetch), { name: 'Error', message });

test('lists a board’s listed jobs with the fields the app keeps', async () => {
  const { fetch, requested } = fakeAshby({
    acme: [
      { id: 'a1', title: '  Backend Engineer ' },
      { id: 'a2', isListed: false },
    ],
  });
  assert.deepEqual(await ashbyBoard.listJobs('Acme', fetch), [
    {
      externalId: 'a1',
      title: 'Backend Engineer',
      company: null,
      location: 'Helsinki, Finland',
      url: 'https://jobs.ashbyhq.com/acme/a1',
      publishedAt: '2026-09-01T10:00:00.000+00:00',
    },
  ]);
  assert.deepEqual(requested, ['https://api.ashbyhq.com/posting-api/job-board/Acme']);
});

test('writes every location with its country, as the location rule reads them', async () => {
  const { fetch } = fakeAshby({
    acme: [
      { id: '1', location: 'Turku' },
      {
        id: '2',
        location: 'London',
        country: 'United Kingdom',
        secondaryLocations: [{ location: 'Espoo', country: 'Finland' }, { location: 'Berlin' }],
      },
      // The country is not repeated, and a location that is only a country stays as it is.
      { id: '3', location: 'Lisbon, Portugal', country: 'Portugal' },
      { id: '4', location: '', country: 'Finland' },
      { id: '5', location: null, country: null },
    ],
  });
  assert.deepEqual(
    (await ashbyBoard.listJobs('acme', fetch)).map((p) => p.location),
    [
      'Turku, Finland',
      'London, United Kingdom; Espoo, Finland; Berlin',
      'Lisbon, Portugal',
      'Finland',
      '',
    ],
  );
});

test('marks remote jobs in the location text', async () => {
  const { fetch } = fakeAshby({
    acme: [
      { id: '1', workplaceType: 'Remote', location: 'Finland', country: null },
      { id: '2', workplaceType: 'Remote', location: 'Remote (EU)', country: null },
      { id: '3', workplaceType: 'Remote', location: null, country: null },
      // Hybrid is an office job, whatever the older `isRemote` says.
      { id: '4', workplaceType: 'Hybrid', isRemote: true },
      // Older jobs have only `isRemote`.
      { id: '5', workplaceType: null, isRemote: true, location: 'Europe', country: null },
      { id: '6', workplaceType: null, isRemote: null },
    ],
  });
  assert.deepEqual(
    (await ashbyBoard.listJobs('acme', fetch)).map((p) => p.location),
    [
      'Remote - Finland',
      'Remote (EU)',
      'Remote',
      'Helsinki, Finland',
      'Remote - Europe',
      'Helsinki, Finland',
    ],
  );
});

test('cuts a very long list of locations so it can be saved, without losing the job', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    location: `${'Long town name '.repeat(4)}${i}`,
    country: 'Spain',
  }));
  const { fetch } = fakeAshby({ acme: [{ id: '1', secondaryLocations: many }] });
  const [posting] = await ashbyBoard.listJobs('acme', fetch);
  assert.ok(posting!.location.length <= 5000);
  assert.ok(posting!.location.startsWith('Helsinki, Finland; Long town name'));
  assert.ok(posting!.location.endsWith('; …'), posting!.location.slice(-20));
});

test('links the board page when the job link is not https', async () => {
  const { fetch } = fakeAshby({
    acme: [
      { id: '1', jobUrl: 'javascript:alert(1)' },
      { id: '2', jobUrl: 'https://careers.example.com/jobs/2' },
    ],
  });
  assert.deepEqual(
    (await ashbyBoard.listJobs('acme', fetch)).map((p) => p.url),
    ['https://jobs.ashbyhq.com/acme/1', 'https://careers.example.com/jobs/2'],
  );
});

test('says plainly why a board could not be read', async () => {
  await failsWith(fakeAshby({}).fetch, 'Ashby has no job board called nope.', 'nope');
  await failsWith(fakeAshby({ acme: 502 }).fetch, 'api.ashbyhq.com answered HTTP 502.');
  for (const body of [
    { jobs: null },
    { jobs: [{ id: 1, title: 'A' }] },
    { jobs: [{ id: 'x', title: ' ' }] },
  ]) {
    await failsWith(
      fakeAshby({ acme: async () => Response.json(body) }).fetch,
      'Ashby answered with something other than a list of jobs.',
    );
  }
});

test('reads one listed job’s text from the board', async () => {
  const { fetch, requested } = fakeAshby({
    acme: [
      { id: 'a1', descriptionPlain: 'Other job.' },
      {
        id: 'a2',
        title: 'Data Engineer',
        descriptionPlain: '\r\nAbout us\r\n\r\n\r\nYou   know SQL. \n',
      },
      { id: 'a3', isListed: false },
    ],
  });
  assert.deepEqual(await ashbyBoard.readJob('Acme', 'a2', fetch), {
    title: 'Data Engineer',
    company: null,
    location: 'Helsinki, Finland',
    url: 'https://jobs.ashbyhq.com/acme/a2',
    text: 'About us\n\nYou   know SQL.',
  });
  assert.deepEqual(requested, ['https://api.ashbyhq.com/posting-api/job-board/Acme']);
  // 未列出的职位只给知道直接链接的人看，应用也不读取它。
  await assert.rejects(ashbyBoard.readJob('acme', 'a3', fetch), {
    message: 'The Ashby board acme no longer lists this job.',
  });
  await assert.rejects(
    ashbyBoard.readJob(
      'acme',
      'a1',
      fakeAshby({ acme: [{ id: 'a1', descriptionPlain: ' ' }] }).fetch,
    ),
    { message: 'Ashby gives no text for this job.' },
  );
});
