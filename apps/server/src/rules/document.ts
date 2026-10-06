import type { DocumentBlock, Draft, DraftKind, DraftStatement, Profile } from '@jsa/shared';
import { entrySections } from './draft.ts';

// The finished document (T08): the statements in the document, in their places, with the user's
// details written by the app. The web page renders these blocks and adds no text of its own, and
// an uploaded PDF must have exactly their text (rules/pdf.ts), so both come from here.

const headings: Record<(typeof entrySections)[number], string> = {
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
  languages: 'Languages',
  certifications: 'Certifications',
};

export const kindNames: Record<DraftKind, string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
};

// The cover letter's opening and sign-off, written by the app (T07 asks DeepSeek for neither).
export const salutation = 'Dear Hiring Manager,';
export const signOff = 'Kind regards,';

/** A link as documents show it: without the scheme, `www.` or a trailing slash. */
export function linkText(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

function contactBlock(profile: Profile): DocumentBlock[] {
  const items = [
    ...(profile.email ? [{ text: profile.email, href: `mailto:${profile.email}` }] : []),
    ...(profile.phone ? [{ text: profile.phone, href: null }] : []),
    ...(profile.location ? [{ text: profile.location, href: null }] : []),
    ...profile.links.map((url) => ({ text: linkText(url), href: url })),
  ];
  return items.length ? [{ type: 'contact', items }] : [];
}

const sentences = (statements: readonly DraftStatement[]) =>
  statements.map((s) => s.text).join(' ');

/** The document's blocks in order, from the statements that go into it. */
export function documentBlocks(
  draft: Pick<Draft, 'kind' | 'statements'>,
  profile: Profile,
): DocumentBlock[] {
  const kept = draft.statements.filter((s) => s.inDocument);
  const name: DocumentBlock[] = profile.name ? [{ type: 'name', text: profile.name }] : [];

  if (draft.kind === 'cover_letter') {
    const paragraphs = new Map<number, DraftStatement[]>();
    for (const s of kept) paragraphs.set(s.block, [...(paragraphs.get(s.block) ?? []), s]);
    return [
      ...name,
      ...contactBlock(profile),
      { type: 'paragraph', text: salutation },
      ...[...paragraphs.values()].map((p): DocumentBlock => ({
        type: 'paragraph',
        text: sentences(p),
      })),
      { type: 'closing', lines: profile.name ? [signOff, profile.name] : [signOff] },
    ];
  }

  const of = (section: string) => kept.filter((s) => s.section === section);
  const headline = of('headline');
  const summary = of('summary');
  const blocks: DocumentBlock[] = [
    ...name,
    ...(headline.length ? [{ type: 'headline', text: sentences(headline) } as const] : []),
    ...contactBlock(profile),
    ...(summary.length ? [{ type: 'paragraph', text: sentences(summary) } as const] : []),
  ];
  for (const section of entrySections) {
    const entries = new Map<number, { title?: string; bullets: string[] }>();
    for (const s of of(section)) {
      const entry = entries.get(s.block) ?? { bullets: [] };
      if (s.line === 'title') entry.title = s.text;
      else entry.bullets.push(s.text);
      entries.set(s.block, entry);
    }
    if (entries.size === 0) continue;
    blocks.push({ type: 'heading', text: headings[section] });
    const all = [...entries.values()];
    // Entries that are one line each, such as skills or languages, make one list.
    if (all.every((entry) => entry.bullets.length === 0)) {
      blocks.push({ type: 'bullets', items: all.map((entry) => entry.title!) });
      continue;
    }
    for (const entry of all) {
      if (entry.title) blocks.push({ type: 'entry', text: entry.title });
      if (entry.bullets.length) blocks.push({ type: 'bullets', items: entry.bullets });
    }
  }
  return blocks;
}

/** Every text of the document in reading order, one piece per line or item. */
export function documentPieces(blocks: readonly DocumentBlock[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'contact':
        return block.items.map((item) => item.text);
      case 'bullets':
        return block.items;
      case 'closing':
        return block.lines;
      default:
        return [block.text];
    }
  });
}

/** Why no PDF of the document can be kept yet; empty when one can. */
export function documentMissing(
  draft: Pick<Draft, 'statements'>,
  profile: Pick<Profile, 'name'>,
): string[] {
  return [
    ...(profile.name ? [] : ['Add your name on the Your details page.']),
    ...(draft.statements.some((s) => s.inDocument) ? [] : ['No statement is in the document.']),
  ];
}

/**
 * The PDF's file name without `.pdf`: whose it is, what it is and which job it is for, so files of
 * different jobs cannot be mixed up. Only characters every file system accepts.
 */
export function documentFileName(
  kind: DraftKind,
  job: { title: string; company: string | null },
  profile: Pick<Profile, 'name'>,
): string {
  return [profile.name, kindNames[kind], job.company ?? '', job.title]
    .map((part) =>
      part
        .replace(/[\p{Cc}\\/:*?"<>|]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((part) => part !== '')
    .join(' - ')
    .slice(0, 150)
    .trim();
}
