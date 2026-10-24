import assert from 'node:assert/strict';
import dns, { type LookupAddress } from 'node:dns';
import { EventEmitter } from 'node:events';
import https, { type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { companyJob, publicAddress, readCompanyPage } from './company-page.ts';

const url = 'https://careers.example.com/jobs/1';
const description =
  '<p>Responsibilities: Build reliable services for our customers.</p><p>Requirements: Experience developing and maintaining production software.</p>';
const posting = {
  '@type': 'JobPosting',
  title: 'Engineer',
  description,
  hiringOrganization: { name: 'Acme' },
  jobLocation: { address: { addressLocality: 'Helsinki', addressCountry: 'FI' } },
};
const metadata = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

test('extracts one structured job, including graph metadata, without navigation', () => {
  assert.deepEqual(companyJob(`<nav>Other jobs</nav>${metadata({ '@graph': [posting] })}`, url), {
    title: 'Engineer',
    company: 'Acme',
    location: 'Helsinki, FI',
    url,
    text: 'Responsibilities: Build reliable services for our customers.\n\nRequirements: Experience developing and maintaining production software.',
  });
  assert.equal(companyJob(metadata([posting]), url).title, 'Engineer');
});

test('reads SuccessFactors-style Microdata without h1/main or JSON-LD and excludes surrounding UI', () => {
  const job = companyJob(
    `<header><span itemprop="title">Navigation title</span></header>
    <div itemscope itemtype="http://schema.org/JobPosting">
      <div itemscope itemtype="https://schema.org/Organization">
        <span itemprop="title">Organization title</span><span itemprop="description">Organization description</span>
      </div>
      <span itemprop="title">Document Processing Developer</span>
      <span itemprop="description"><div>${description}<p>Read &lt;document&gt; &amp; preserve it.</p><script>hidden()</script><style>.secret{}</style></div></span>
      <aside>Apply now</aside>
    </div><footer>Cookie preferences</footer>`,
    url,
  );
  assert.equal(job.title, 'Document Processing Developer');
  assert.equal(
    job.text,
    companyJob(metadata(posting), url).text + '\n\nRead <document> & preserve it.',
  );
  assert.equal(job.company, null);
  assert.equal(job.location, '');
  assert.doesNotMatch(job.text, /Navigation|Organization|Apply now|Cookie|hidden|secret/);
});

test('supports meta Microdata values and keeps valid JSON-LD preferred on dual-marked pages', () => {
  const microdata = `<div itemscope itemtype="https://schema.org/JobPosting">
    <meta itemprop="name title" content="Microdata Engineer">
    <div itemprop="description">${description}</div></div>`;
  assert.equal(companyJob(microdata, url).title, 'Microdata Engineer');
  assert.equal(companyJob(metadata(posting) + microdata, url).title, 'Engineer');
  assert.equal(
    companyJob('<script type="application/ld+json">broken</script>' + microdata, url).title,
    'Microdata Engineer',
  );
});

test('Microdata must describe one complete job and retains the title/text size limits', () => {
  const microdata = (title: string, text: string) =>
    `<div itemscope itemtype="https://schema.org/JobPosting"><span itemprop="title">${title}</span><span itemprop="description">${text}</span></div>`;
  for (const html of [
    microdata('Engineer', description) + microdata('Other', description),
    microdata('', description),
    microdata('Engineer', ''),
    microdata('Engineer', 'Please sign in'),
    microdata('Engineer', 'x'.repeat(100_001)),
    microdata('x'.repeat(1001), description),
    `<div><span itemprop="title">Engineer</span><span itemprop="description">${description}</span></div>`,
    `<div itemscope itemtype="https://evil.test/JobPosting"><span itemprop="title">Engineer</span><span itemprop="description">${description}</span></div>`,
  ])
    assert.throws(() => companyJob(html, url));
});

test('decodes entity-escaped job HTML used by Teamtailor company pages', () => {
  const encoded = description
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const job = companyJob(metadata({ ...posting, description: encoded }), url);
  assert.equal(job.text, companyJob(metadata(posting), url).text);
  assert.doesNotMatch(job.text, /<[^>]+>|&lt;|&gt;/);
});

test('uses readable main content when structured metadata is missing or invalid', () => {
  const job = companyJob(
    `<script type="application/ld+json">broken</script><nav>Navigation</nav><main><h1>Engineer</h1>${description}<script>secret()</script></main>`,
    url,
  );
  assert.equal(job.title, 'Engineer');
  assert.match(job.text, /Requirements/);
  assert.doesNotMatch(job.text, /Navigation|secret/);
});

test('rejects lists, login pages, empty app shells and oversized descriptions', () => {
  for (const html of [
    metadata([posting, posting]),
    '<h1>Sign in</h1><main>Please log in</main>',
    '<div id="app"></div>',
    metadata({ ...posting, description: 'x'.repeat(100_001) }),
  ]) {
    assert.throws(() => companyJob(html, url));
  }
});

test('only public unicast addresses are eligible for a connection', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
    'not an address',
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(publicAddress(address), true, address);
});

test('rejects unsafe URLs and restricted sites before connecting', async () => {
  for (const address of [
    'https://127.0.0.1/job',
    'https://[::1]/job',
    'https://localhost/job',
    'https://user:pass@example.com/job',
    'https://example.com:8443/job',
    'http://example.com/job',
    'https://www.linkedin.com/jobs/1',
  ]) {
    await assert.rejects(readCompanyPage(address), { statusCode: 400 });
  }
});

test('reads a bounded response and validates redirect targets before another connection', async (t) => {
  let calls = 0;
  let redirect = false;
  let large = false;
  t.mock.method(
    https,
    'get',
    (_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      calls++;
      assert.equal(options.agent, false);
      assert.equal(typeof options.lookup, 'function');
      assert.ok(options.signal);
      const request = new EventEmitter() as EventEmitter & { destroy(error: Error): void };
      request.destroy = (error) => {
        request.emit('error', error);
      };
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: object;
          destroy(): void;
        };
        response.statusCode = redirect ? 302 : 200;
        response.headers = redirect
          ? { location: 'https://127.0.0.1/private' }
          : { 'content-type': 'text/html; charset=utf-8' };
        response.destroy = () => {};
        callback(response as unknown as IncomingMessage);
        if (!redirect) {
          response.emit(
            'data',
            Buffer.from(
              large
                ? 'x'.repeat(2 * 1024 * 1024 + 1)
                : `<div itemscope itemtype="https://schema.org/JobPosting"><span itemprop="title">Engineer</span><div itemprop="description">${description}</div></div>`,
            ),
          );
          response.emit('end');
        }
      });
      return request;
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.equal((await readCompanyPage(url)).title, 'Engineer');
  large = true;
  await assert.rejects(readCompanyPage(url), /exceeds 2 MB/);
  redirect = true;
  const before = calls;
  await assert.rejects(readCompanyPage(url), { statusCode: 400 });
  assert.equal(calls, before + 1);
});

test('the connection lookup rejects mixed private DNS answers and pins public answers', async (t) => {
  let answers: LookupAddress[] = [{ address: '8.8.8.8', family: 4 }];
  let all = true;
  t.mock.method(
    dns,
    'lookup',
    (
      _host: string,
      _options: unknown,
      callback: (error: Error | null, addresses: LookupAddress[]) => void,
    ) => callback(null, answers),
  );
  t.mock.method(https, 'get', (_url: URL, options: RequestOptions) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const lookup = options.lookup as (
        host: string,
        options: { all: boolean },
        callback: (error: Error | null, address: LookupAddress[] | string, family?: number) => void,
      ) => void;
      lookup('careers.example.com', { all }, (error, address, family) => {
        if (answers.length > 1) assert.match(error!.message, /public website/);
        else {
          assert.equal(error, null);
          assert.deepEqual(address, all ? answers : '8.8.8.8');
          if (!all) assert.equal(family, 4);
        }
        request.emit('error', error ?? new Error('checked public address'));
      });
    });
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(readCompanyPage(url), /Could not read/);
  all = false;
  await assert.rejects(readCompanyPage(url), /Could not read/);
  answers = [...answers, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(readCompanyPage(url), /Could not read/);
});
