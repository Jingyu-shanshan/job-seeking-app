import assert from 'node:assert/strict';
import { test } from 'node:test';
import { companyKey, locationKey, sameJobKey, titleKey, uniqueJobs } from './same-job.ts';

test('company names compare without case, accents, punctuation, spacing or legal form', () => {
  assert.equal(companyKey('HiQ Finland Oy'), companyKey('hiqfinland'));
  assert.equal(companyKey('Wärtsilä Oyj Abp'), companyKey('wartsila'));
  assert.equal(companyKey('Acme, Inc.'), companyKey('acme'));
  assert.equal(companyKey('Kesko Oyj'), 'kesko');
  // A name that is only a legal form keeps it.
  assert.equal(companyKey('Oy'), 'oy');
  assert.notEqual(companyKey('Acme Labs'), companyKey('Acme'));
});

test('titles compare without case, punctuation or spacing, and nothing else', () => {
  assert.equal(titleKey('Full-Stack Engineer'), titleKey('Fullstack engineer'));
  assert.equal(
    titleKey('Senior Software Engineer (Python)'),
    titleKey('senior software engineer, python'),
  );
  assert.equal(titleKey('Ohjelmistokehittäjä'), titleKey('ohjelmistokehittaja'));
  assert.notEqual(titleKey('Sr. Software Engineer'), titleKey('Senior Software Engineer'));
  assert.notEqual(titleKey('Software Engineer'), titleKey('Software Engineer II'));
});

test('a key needs both a company and a title', () => {
  assert.equal(sameJobKey(null, 'Engineer'), null);
  assert.equal(sameJobKey('  ', 'Engineer'), null);
  assert.equal(sameJobKey('Acme', '—'), null);
  assert.equal(sameJobKey('Acme Oy', 'Data Engineer'), sameJobKey('ACME', 'data engineer'));
  assert.equal(locationKey('Helsinki, Uusimaa'), locationKey('helsinki uusimaa'));
});

test('a key belongs to a job only when exactly one job has it', () => {
  const jobs = uniqueJobs([
    { key: 'a', jobId: '1' },
    { key: 'a', jobId: '1' },
    { key: 'b', jobId: '2' },
    { key: 'b', jobId: '3' },
    { key: null, jobId: '4' },
  ]);
  assert.equal(jobs.get('a'), '1');
  assert.equal(jobs.get('b'), null);
  assert.equal(jobs.has('c'), false);
});
