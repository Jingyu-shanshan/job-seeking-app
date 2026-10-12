import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { unzip } from '../testing/zip.ts';
import { zip } from './zip.ts';

const entries = [
  { name: 'facts.md', data: Buffer.from('# Experience\n\n- Kehittäjä – 开发者\n'.repeat(50)) },
  { name: 'files/a.pdf', data: Buffer.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3]) },
  { name: 'empty.txt', data: Buffer.alloc(0) },
];

test('zip writes entries that read back unchanged, compressing only where it helps', () => {
  const archive = zip(entries, new Date('2026-10-09T12:34:56Z'));
  const files = unzip(archive);
  assert.deepEqual(
    [...files.keys()],
    entries.map((e) => e.name),
  );
  for (const e of entries) assert.deepEqual(files.get(e.name), e.data);
  assert.ok(archive.length < entries[0]!.data.length, 'the repeated text is deflated');
});

test('the system unzip accepts the archive', (t) => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    t.skip('unzip is not installed');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'jsa-zip-'));
  try {
    const path = join(dir, 'export.zip');
    writeFileSync(path, zip(entries, new Date('2026-10-09T12:34:56Z')));
    const out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.equal(
      execFileSync('unzip', ['-p', path, 'facts.md']).toString(),
      entries[0]!.data.toString(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
