import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Job, Outcome } from '@jsa/shared';
import { compareJobs } from './job-ranking.ts';

const job = (id: string, outcome?: Outcome, override: Partial<Job> = {}): Job => ({
  id,
  title: id,
  company: null,
  location: '',
  url: null,
  sources: [],
  alerts: [],
  firstSeenAt: '2026-10-01T00:00:00Z',
  publishedAt: null,
  origin: 'discovered',
  needsText: false,
  verdict: 'eligible',
  application: null,
  criteria: outcome
    ? [
        {
          criterion: 'title',
          strength: 'preference',
          outcome,
          effect: 'none',
          reason: '',
          quote: null,
        },
      ]
    : [],
  ...override,
});

test('matching roles lead newer unrelated jobs; hard failures never become recommendations', () => {
  const ordered = [
    job('newer-unrelated', 'unmet', { publishedAt: '2026-10-20T00:00:00Z' }),
    job('unknown'),
    job('matching-role', 'met'),
    job('ruled-out-match', 'met', { verdict: 'ineligible' }),
    job('role-to-confirm', 'met', { verdict: 'to_confirm' }),
  ].sort(compareJobs);
  assert.deepEqual(
    ordered.map((job) => job.id),
    ['matching-role', 'unknown', 'newer-unrelated', 'role-to-confirm', 'ruled-out-match'],
  );
});

test('preferences break role ties, then publication dates and deterministic IDs', () => {
  const matching = job('preferred', 'met');
  matching.criteria.push({
    criterion: 'employmentType',
    strength: 'preference',
    outcome: 'met',
    effect: 'none',
    reason: '',
    quote: null,
  });
  const ordered = [
    job('older', 'met', { publishedAt: '2026-10-02T00:00:00Z' }),
    job('newer', 'met', { publishedAt: '2026-10-03T00:00:00Z' }),
    matching,
  ].sort(compareJobs);
  assert.deepEqual(
    ordered.map((job) => job.id),
    ['preferred', 'newer', 'older'],
  );
  assert.equal(compareJobs(matching, matching), 0);
});
