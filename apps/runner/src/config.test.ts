import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runnerConfig } from './config.ts';

const token = `jsa_runner_${'a'.repeat(43)}`;

test('the app’s address: the local server by default, https elsewhere', () => {
  assert.equal(runnerConfig({ JSA_RUNNER_TOKEN: token }).appUrl.href, 'http://127.0.0.1:3000/');
  assert.equal(
    runnerConfig({ JSA_RUNNER_TOKEN: token, JSA_APP_URL: 'https://jobs.example.com/some/path' })
      .appUrl.href,
    'https://jobs.example.com/',
  );
  assert.equal(
    runnerConfig({ JSA_RUNNER_TOKEN: token, JSA_APP_URL: 'http://localhost:4200' }).appUrl.href,
    'http://localhost:4200/',
  );
  for (const [url, message] of [
    ['http://jobs.example.com', /must be an https URL/],
    ['not a url', /not a valid URL/],
    ['https://me:secret@jobs.example.com', /must not carry a user name/],
  ] as const) {
    assert.throws(() => runnerConfig({ JSA_RUNNER_TOKEN: token, JSA_APP_URL: url }), {
      message,
    });
  }
});

test('the token is required and must be one the app issues', () => {
  assert.equal(runnerConfig({ JSA_RUNNER_TOKEN: ` ${token}\n` }).token, token);
  for (const value of [undefined, '', 'jsa_runner_short', `Bearer ${token}`]) {
    assert.throws(() => runnerConfig({ JSA_RUNNER_TOKEN: value }), /Set JSA_RUNNER_TOKEN/);
  }
});
