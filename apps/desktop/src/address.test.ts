import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressToUrl, isWebAddress } from './address.ts';

test('opens what the user typed as a web address, with https when no scheme is given', () => {
  for (const [typed, url] of [
    ['linkedin.com/jobs', 'https://linkedin.com/jobs'],
    ['  duunitori.fi  ', 'https://duunitori.fi/'],
    ['https://www.linkedin.com/jobs/view/1/', 'https://www.linkedin.com/jobs/view/1/'],
    ['http://example.com/jobs', 'http://example.com/jobs'],
    ['localhost:3000/jobs', 'https://localhost:3000/jobs'],
    [
      'tyomarkkinatori.fi/henkiloasiakkaat?q=java',
      'https://tyomarkkinatori.fi/henkiloasiakkaat?q=java',
    ],
  ]) {
    assert.equal(addressToUrl(typed!), url, typed);
  }
});

test('opens nothing for other schemes, search words or an empty bar', () => {
  for (const typed of [
    '',
    '   ',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'chrome://settings',
    'about:config',
    'software engineer helsinki',
    'jobs',
  ]) {
    assert.equal(addressToUrl(typed), null, typed);
  }
});

test('the built-in browser shows web pages and its empty start page only', () => {
  assert.ok(isWebAddress('https://www.linkedin.com/'));
  assert.ok(isWebAddress('http://example.com/'));
  assert.ok(isWebAddress('about:blank'));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@example.com']) {
    assert.ok(!isWebAddress(url), url);
  }
});
