import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobPageAddress } from './job-page.ts';

const job = { url: 'https://www.linkedin.com/jobs/view/4012345678/' };

test('gives every LinkedIn address of one job the same address', () => {
  for (const address of [
    'https://www.linkedin.com/jobs/view/4012345678/',
    'https://www.linkedin.com/jobs/view/4012345678',
    'https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=def#top',
    'https://fi.linkedin.com/jobs/view/software-engineer-at-acme-4012345678?position=1&pageNum=0',
    'https://linkedin.com/comm/jobs/view/4012345678/',
    'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer',
    'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678',
  ]) {
    assert.deepEqual(jobPageAddress(address), job, address);
  }
});

test('refuses a LinkedIn page that names no job', () => {
  for (const address of [
    'https://www.linkedin.com/feed/',
    'https://www.linkedin.com/jobs/search/?keywords=engineer',
    'https://www.linkedin.com/jobs/search/?currentJobId=abc',
    'https://www.linkedin.com/jobs/view/software-engineer/',
  ]) {
    const result = jobPageAddress(address);
    assert.ok('error' in result, address);
    assert.match(result.error, /not a job’s page/);
  }
});

test('does not take a look-alike host for LinkedIn', () => {
  assert.deepEqual(jobPageAddress('https://notlinkedin.com/jobs/view/4012345678/'), {
    url: 'https://notlinkedin.com/jobs/view/4012345678/',
  });
});

test('keeps other addresses but drops the fragment and tracking parameters', () => {
  assert.deepEqual(
    jobPageAddress(
      'https://duunitori.fi/tyopaikat/tyo/ohjelmistokehittaja-123?utm_source=x&UTM_Medium=y&gclid=1#apply',
    ),
    { url: 'https://duunitori.fi/tyopaikat/tyo/ohjelmistokehittaja-123' },
  );
  assert.deepEqual(jobPageAddress('https://acme.example/careers?gh_jid=42&fbclid=z'), {
    url: 'https://acme.example/careers?gh_jid=42',
  });
  assert.deepEqual(jobPageAddress('HTTPS://Acme.Example/Jobs/7'), {
    url: 'https://acme.example/Jobs/7',
  });
});

test('refuses addresses that are not https or carry credentials', () => {
  for (const [address, reason] of [
    ['http://acme.example/jobs/7', /https/],
    ['file:///Users/me/job.html', /https/],
    ['not a url', /not valid/],
    ['https://me:secret@acme.example/jobs/7', /password/],
  ] as const) {
    const result = jobPageAddress(address);
    assert.ok('error' in result, address);
    assert.match(result.error, reason);
  }
});
