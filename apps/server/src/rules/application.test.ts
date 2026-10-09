import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cannotRecord, clockSlackMs, repeatedFiles, sentAtProblem } from './application.ts';

describe('cannotRecord', () => {
  const ready = { hasText: true, openApplication: null, openFill: false } as const;

  it('lets a job with text and no application or fill be recorded', () => {
    assert.equal(cannotRecord(ready), null);
  });

  it('refuses a job whose application went in or may have', () => {
    assert.match(cannotRecord({ ...ready, openApplication: 'submitted' })!, /went in already/);
    assert.match(cannotRecord({ ...ready, openApplication: 'to_verify' })!, /unknown/);
  });

  it('refuses while the runner has a fill of the form open', () => {
    assert.match(cannotRecord({ ...ready, openFill: true })!, /Close the runner’s fill/);
  });

  it('refuses a job without text, since the record keeps the text', () => {
    assert.match(cannotRecord({ ...ready, hasText: false })!, /Save or paste the job’s text/);
  });
});

describe('sentAtProblem', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('takes now and any time before', () => {
    assert.equal(sentAtProblem(now, now), null);
    assert.equal(sentAtProblem(new Date('2025-01-01T08:00:00Z'), now), null);
  });

  it('allows a browser clock a few minutes fast, and no more', () => {
    assert.equal(sentAtProblem(new Date(now.getTime() + clockSlackMs), now), null);
    assert.match(
      sentAtProblem(new Date(now.getTime() + clockSlackMs + 1000), now)!,
      /in the future/,
    );
  });

  it('refuses a time that is not one', () => {
    assert.match(sentAtProblem(new Date('nonsense'), now)!, /Give the date/);
  });
});

describe('repeatedFiles', () => {
  it('names each file that is the same as one before it', () => {
    assert.deepEqual(
      repeatedFiles([
        { fileName: 'a.pdf', sha256: '1' },
        { fileName: 'b.pdf', sha256: '2' },
        { fileName: 'a copy.pdf', sha256: '1' },
      ]),
      ['a copy.pdf'],
    );
    assert.deepEqual(repeatedFiles([]), []);
  });
});
