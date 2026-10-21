import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobLink } from './job-link.ts';

test('recognises job links without following their address or tracking parameters', () => {
  for (const url of [
    'https://job-boards.greenhouse.io/Acme/jobs/123?utm_source=alert',
    'https://boards.greenhouse.io/acme/jobs/123/',
    'https://boards.greenhouse.io/embed/job_app?for=acme&token=123',
  ])
    assert.deepEqual(jobLink(url), { catalogId: 'greenhouse_board', board: 'acme', id: '123' });
  assert.deepEqual(jobLink('https://jobs.ashbyhq.com/acme/abc-123/application'), {
    catalogId: 'ashby_board',
    board: 'acme',
    id: 'abc-123',
  });
});

test('rejects unsupported sites, non-job pages and unsafe addresses before any request', () => {
  for (const url of [
    'not a link',
    'http://boards.greenhouse.io/acme/jobs/1',
    'https://user:password@boards.greenhouse.io/acme/jobs/1',
    'https://boards.greenhouse.io:8080/acme/jobs/1',
    'https://boards.greenhouse.io.evil.test/acme/jobs/1',
    'https://127.0.0.1/acme/jobs/1',
    'https://[::1]/acme/jobs/1',
    'https://www.linkedin.com/jobs/view/123',
    'https://duunitori.fi/tyopaikat/tyo/example',
    'https://www.jobly.fi/tyopaikka/example',
    'https://boards.greenhouse.io/acme',
    'https://boards.greenhouse.io/acme/jobs/1/extra',
    'https://boards.greenhouse.io/embed/job_app?for=acme%2F..&token=1',
    'https://jobs.ashbyhq.com/acme',
    'https://jobs.ashbyhq.com/acme/abc/extra',
  ])
    assert.equal(jobLink(url), null, url);
});
