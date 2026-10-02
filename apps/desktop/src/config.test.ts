import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appUrlFrom } from './config.ts';

test('the app is the local server unless JSA_APP_URL says otherwise', () => {
  assert.equal(appUrlFrom({}).href, 'http://127.0.0.1:3000/');
  assert.equal(
    appUrlFrom({ JSA_APP_URL: 'http://localhost:4200/jobs' }).href,
    'http://localhost:4200/',
  );
  assert.equal(
    appUrlFrom({ JSA_APP_URL: 'https://jobs.example.com' }).href,
    'https://jobs.example.com/',
  );
});

test('the app address must be https unless it is on this computer', () => {
  for (const [value, message] of [
    ['http://jobs.example.com', /https/],
    ['ftp://127.0.0.1', /https/],
    ['not a url', /not a valid URL/],
    ['https://me:pw@jobs.example.com', /user name or password/],
  ] as const) {
    assert.throws(() => appUrlFrom({ JSA_APP_URL: value }), message);
  }
});
