import type { ApplicationStatus, FactKind } from '@jsa/shared';

export interface ExportedFact {
  kind: FactKind;
  body: string;
}

// Headings that `parseFactsMarkdown` (facts/markdown.ts) maps back to the same kind.
const headings: [FactKind, string][] = [
  ['statement', 'Summary'],
  ['experience', 'Experience'],
  ['project', 'Projects'],
  ['education', 'Education'],
  ['skill', 'Skills'],
  ['language', 'Languages'],
  ['certification', 'Certifications'],
  ['other', 'Other'],
];

/**
 * The facts as Markdown that the Facts page can import again: one heading per kind, one list item
 * per fact. The note goes in the front matter, which the importer skips. Continuation lines are
 * indented four spaces, so a line starting with `#` or `-` stays part of its fact; blank lines
 * inside a fact are dropped.
 */
export function factsMarkdown(facts: readonly ExportedFact[], exportedAt: Date): string {
  const out = [
    '---',
    `exported: ${exportedAt.toISOString()}`,
    'note: The current, confirmed version of each fact. Importing this file on the Facts page adds them as proposed facts.',
    '---',
  ];
  for (const [kind, heading] of headings) {
    const ofKind = facts.filter((f) => f.kind === kind);
    if (!ofKind.length) continue;
    out.push('', `## ${heading}`, '');
    for (const fact of ofKind) {
      const lines = fact.body
        .split(/\r\n?|\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      out.push(`- ${lines[0] ?? ''}`, ...lines.slice(1).map((l) => `    ${l}`));
    }
  }
  return `${out.join('\n')}\n`;
}

export interface ExportedApplication {
  title: string;
  company: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
  method: 'runner' | 'manual';
  submittedAt: Date | null;
  createdAt: Date;
  note: string;
  files: { label: string; fileName: string; path: string; sha256: string }[];
}

/** A readable list of the applications, linking each sent file to its place in the export. */
export function applicationsMarkdown(
  applications: readonly ExportedApplication[],
  exportedAt: Date,
): string {
  const out = ['---', `exported: ${exportedAt.toISOString()}`, '---', '', '# Applications'];
  if (!applications.length) out.push('', 'No applications yet.');
  for (const a of applications) {
    out.push(
      '',
      `## ${markdownText(a.title)}${a.company ? ` — ${markdownText(a.company)}` : ''}`,
      '',
    );
    const how = a.method === 'runner' ? 'by the runner' : 'recorded by you';
    out.push(
      a.status === 'submitted'
        ? `- Submitted ${utc(a.submittedAt!)} (${how})`
        : a.status === 'not_submitted'
          ? `- Did not go through: the runner pressed Submit ${utc(a.createdAt)}`
          : `- Result unknown, to verify: the runner pressed Submit ${utc(a.createdAt)}`,
    );
    if (a.sourceUrl) out.push(`- Job page: <${a.sourceUrl}>`);
    if (a.note) out.push(`- Note: ${markdownText(a.note)}`);
    if (a.files.length) {
      out.push('- Files sent:');
      for (const f of a.files) {
        const label = f.label ? `${markdownText(f.label)}: ` : '';
        out.push(`  - ${label}[${markdownText(f.fileName)}](<${f.path}>), SHA-256 ${f.sha256}`);
      }
    } else {
      out.push('- No files kept for it.');
    }
  }
  return `${out.join('\n')}\n`;
}

function markdownText(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_[\]()<>]/g, '\\$&');
}

function utc(d: Date) {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
