import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobLinkImportProblem } from './job-link-import.ts';

test('explains site restrictions for domains and their subdomains', () => {
  for (const url of [
    'https://linkedin.com/jobs/view/1',
    'https://fi.linkedin.com/jobs/view/1',
    'HTTPS://WWW.LINKEDIN.COM./jobs/view/1',
  ]) {
    assert.match(jobLinkImportProblem(url)!, /LinkedIn does not permit automated scraping/);
  }
  assert.match(
    jobLinkImportProblem('https://duunitori.fi/tyopaikat/tyo/example')!,
    /permission for automated access has not been established/,
  );
  assert.match(jobLinkImportProblem('https://www.duunitori.fi/tyopaikat')!, /Duunitori/);
  assert.match(
    jobLinkImportProblem('https://www.jobly.fi/tyopaikka/example')!,
    /not supported yet/,
  );
  assert.match(
    jobLinkImportProblem('https://linkedin.com/jobs/view/1')!,
    /Paste the job text below/,
  );
});

test('does not mistake job links, lookalike hosts or invalid input for a restricted site', () => {
  for (const url of [
    '',
    'not a link',
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://jobs.ashbyhq.com/acme/abc',
    'https://linkedin.com.evil.test/jobs',
    'https://linkedin.com@careers.example.test/jobs',
    'https://notduunitori.fi/jobs',
  ]) {
    assert.equal(jobLinkImportProblem(url), undefined, url);
  }
});
