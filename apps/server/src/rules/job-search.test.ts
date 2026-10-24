import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobSearchRequest, ToolResult } from '@jsa/shared';
import { jobSearchCandidates, jobSearchQuery } from './job-search.ts';

const terms: Pick<JobSearchRequest, 'role' | 'location' | 'sources'> = {
  role: 'Engineer',
  location: 'Helsinki',
  sources: ['greenhouse_board', 'ashby_board'],
};
const result = (url: string) => ({
  title: 'Unverified title',
  url,
  snippet: 'Unverified snippet',
  summary: 'Not a JD',
  content: 'Not a JD',
});

test('search phrases and source domains come only from explicit selections, in stable order', () => {
  assert.equal(
    jobSearchQuery(terms),
    '"Engineer" "Helsinki" site:job-boards.greenhouse.io OR site:boards.greenhouse.io OR site:jobs.ashbyhq.com',
  );
  assert.equal(
    jobSearchQuery({ ...terms, sources: ['ashby_board', 'greenhouse_board'] }),
    jobSearchQuery(terms),
  );
  assert.equal(
    jobSearchQuery({ ...terms, role: ' C++ OR site:evil.test ', sources: ['ashby_board'] }),
    '"C++ OR site:evil.test" "Helsinki" site:jobs.ashbyhq.com',
  );
  assert.ok(!jobSearchQuery({ ...terms, sources: ['ashby_board'] }).includes('greenhouse'));
});

test('blank terms, escaped phrase injection, no sources and oversized complete queries fail', () => {
  for (const role of ['', '  ', 'Engineer" OR site:evil.test "', 'Engineer\\', 'Engineer\n']) {
    assert.throws(() =>
      jobSearchQuery({ ...terms, role: role === 'Engineer\n' ? 'Engineer\nOther' : role }),
    );
  }
  assert.throws(() => jobSearchQuery({ ...terms, location: ' ' }));
  assert.throws(() => jobSearchQuery({ ...terms, sources: [] }));
  assert.throws(() => jobSearchQuery({ ...terms, role: 'x'.repeat(100) }), /128/);
});

test('only complete job links from selected exact hosts survive; aliases and tracking merge', () => {
  const response: ToolResult = {
    results: [
      'https://boards.greenhouse.io/ACME/jobs/1?utm_source=search',
      'https://job-boards.greenhouse.io/acme/jobs/1#apply',
      'https://boards.greenhouse.io/embed/job_app?for=acme&token=1',
      'https://jobs.ashbyhq.com/acme/a2/application?utm_source=search',
      'https://jobs.ashbyhq.com/acme/a2',
      'https://jobs.ashbyhq.com.evil.test/acme/a2',
      'https://evil.test/acme/jobs/1',
      'http://boards.greenhouse.io/acme/jobs/1',
      'https://user:pass@boards.greenhouse.io/acme/jobs/1',
      'https://boards.greenhouse.io:444/acme/jobs/1',
      'https://boards.greenhouse.io/acme',
      'https://127.0.0.1/acme/jobs/1',
      'https://linkedin.com/jobs/view/1',
      'https://duunitori.fi/jobs/1',
      'javascript:alert(1)',
    ].map(result),
  };
  const found = jobSearchCandidates(response, terms.sources);
  assert.deepEqual(
    found.candidates.map((c) => c.url),
    ['https://job-boards.greenhouse.io/acme/jobs/1', 'https://jobs.ashbyhq.com/acme/a2'],
  );
  assert.equal(found.ignored.length, response.results.length - 2);
  assert.deepEqual(Object.keys(found.candidates[0]!).sort(), ['snippet', 'source', 'title', 'url']);
  assert.equal(jobSearchCandidates(response, ['greenhouse_board']).candidates.length, 1);
  assert.deepEqual(jobSearchCandidates(null, terms.sources), { candidates: [], ignored: [] });
  assert.deepEqual(jobSearchCandidates({ results: [] }, terms.sources), {
    candidates: [],
    ignored: [],
  });
});
