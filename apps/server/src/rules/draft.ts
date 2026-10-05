import type { DraftAbout, DraftKind, DraftLine, DraftSection } from '@jsa/shared';
import Type from 'typebox';
import { Value } from 'typebox/value';
import { sameSet } from './match.ts';

// Drafts (T07): DeepSeek answers with a resume or a cover letter as structured statements. This
// module checks the answer's shape and flattens it into the statements the app stores; whether a
// statement may go into the document is rules/statement.ts.

const Text = Type.String({ maxLength: 2000 });
const Refs = Type.Array(Type.String({ maxLength: 20 }), { maxItems: 50 });

const ResumeStatement = Type.Object({ text: Text, facts: Refs });

const Entry = Type.Object({
  title: ResumeStatement,
  bullets: Type.Array(ResumeStatement, { maxItems: 20 }),
});

const Entries = Type.Array(Entry, { maxItems: 40 });

export const entrySections = [
  'experience',
  'projects',
  'skills',
  'education',
  'languages',
  'certifications',
] as const satisfies readonly DraftSection[];

// A section DeepSeek leaves out is empty.
export const ResumeAnswerSchema = Type.Object({
  headline: Type.Union([ResumeStatement, Type.Null()]),
  summary: Type.Array(ResumeStatement, { maxItems: 10 }),
  experience: Type.Optional(Entries),
  projects: Type.Optional(Entries),
  skills: Type.Optional(Entries),
  education: Type.Optional(Entries),
  languages: Type.Optional(Entries),
  certifications: Type.Optional(Entries),
});

const LetterStatement = Type.Object({
  about: Type.Union([Type.Literal('me'), Type.Literal('job'), Type.Literal('other')]),
  text: Text,
  facts: Type.Optional(Refs),
  quote: Type.Optional(Type.Union([Text, Type.Null()])),
});

export const CoverLetterAnswerSchema = Type.Object({
  paragraphs: Type.Array(Type.Array(LetterStatement, { maxItems: 20 }), { maxItems: 10 }),
});

export interface DraftStatementAnswer {
  section: DraftSection;
  block: number;
  line: DraftLine;
  about: DraftAbout;
  text: string;
  /** Refs of facts that were sent, each once. */
  facts: string[];
  /** Refs the answer cited that were not sent. */
  unsentRefs: string[];
  /** For statements about the job: the passage of the job text they rest on. */
  quote: string | null;
}

/**
 * Checks DeepSeek's answer for a draft and flattens it into statements in document order, or
 * undefined when it does not have the expected shape. Statements with no text are dropped; fact
 * refs that were not sent are kept apart, so the statement can be rejected for them.
 */
export function checkDraftAnswer(
  kind: DraftKind,
  answer: unknown,
  factRefs: readonly string[],
): DraftStatementAnswer[] | undefined {
  const sent = new Set(factRefs);
  const statements: DraftStatementAnswer[] = [];
  const add = (
    place: { section: DraftSection; block: number; line: DraftLine },
    item: { about?: DraftAbout; text: string; facts?: string[]; quote?: string | null },
  ) => {
    const text = item.text.trim();
    if (text === '') return;
    const about = item.about ?? 'me';
    const refs = about === 'other' ? [] : [...new Set((item.facts ?? []).map((ref) => ref.trim()))];
    statements.push({
      ...place,
      about,
      text,
      facts: refs.filter((ref) => sent.has(ref)),
      unsentRefs: refs.filter((ref) => !sent.has(ref)),
      quote: about === 'job' ? item.quote?.trim() || null : null,
    });
  };

  if (kind === 'resume') {
    if (!Value.Check(ResumeAnswerSchema, answer)) return undefined;
    if (answer.headline) add({ section: 'headline', block: 0, line: 'sentence' }, answer.headline);
    for (const item of answer.summary)
      add({ section: 'summary', block: 0, line: 'sentence' }, item);
    for (const section of entrySections) {
      (answer[section] ?? []).forEach((entry, block) => {
        add({ section, block, line: 'title' }, entry.title);
        for (const bullet of entry.bullets) add({ section, block, line: 'bullet' }, bullet);
      });
    }
  } else {
    if (!Value.Check(CoverLetterAnswerSchema, answer)) return undefined;
    answer.paragraphs
      .filter((paragraph) => paragraph.some((item) => item.text.trim() !== ''))
      .forEach((paragraph, block) => {
        for (const item of paragraph) add({ section: 'letter', block, line: 'sentence' }, item);
      });
  }
  return statements;
}

/** Why a draft is out of date; empty when writing again would send the same request. */
export function draftOutdated({
  sentFacts,
  citableFacts,
  newerText,
}: {
  sentFacts: Iterable<string>;
  citableFacts: Iterable<string>;
  newerText: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!sameSet(sentFacts, citableFacts)) {
    reasons.push('The facts that may be used in drafts have changed since.');
  }
  if (newerText) reasons.push('The app has a newer text of this job.');
  return reasons;
}
