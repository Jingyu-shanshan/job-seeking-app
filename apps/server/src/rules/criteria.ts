import type {
  Criteria,
  CriterionResult,
  CriterionStrength,
  EmploymentType,
  IfUnknown,
  JobVerdict,
  Outcome,
  SummaryFieldValue,
} from '@jsa/shared';
import { classifyLocation } from './location.ts';

// The user's criteria checked against one job (T06). Nothing here asks the model: the title and
// location come from the listing, the working language and employment type from the summary's
// fields, whose quotes T05 checked against the job text, and the must-haves from the latest
// evidence match, already reduced to one outcome (rules/match.ts).
//
// A hard criterion that is not met rules the job out; one the job does not state sends it to
// to-confirm, or rules it out for lack of information when the user chose that. An unknown is
// never counted as met, and preferences never change the verdict.

/** One criterion's outcome before its strength is applied. */
export interface Checked {
  outcome: Outcome;
  reason: string;
  quote: string | null;
}

export interface JobToCheck {
  title: string;
  /** The listing's location text; several locations are separated by ";". */
  location: string;
  /**
   * The summary fields of the job's current text: `none` when the app has no text, `unsummarised`
   * when it has not been summarised yet.
   */
  summary:
    | 'none'
    | 'unsummarised'
    | { languages: SummaryFieldValue | null; employmentType: SummaryFieldValue | null };
  mustHaves: Checked;
}

/** Matches `phrase` as whole words, ignoring case and how much space is between them. */
function phrasePattern(phrase: string) {
  const words = phrase.trim().split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu');
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const quoted = (words: readonly string[]) => words.map((w) => `“${w}”`).join(', ');

function checkTitle(title: string, words: readonly string[]): Checked {
  const found = words.find((word) => phrasePattern(word).test(title));
  return found
    ? { outcome: 'met', reason: `The title has “${found}”.`, quote: null }
    : { outcome: 'unmet', reason: `The title has none of ${quoted(words)}.`, quote: null };
}

function checkAvoided(title: string, words: readonly string[]): Checked {
  const found = words.filter((word) => phrasePattern(word).test(title));
  return found.length
    ? { outcome: 'unmet', reason: `The title has ${quoted(found)}.`, quote: null }
    : { outcome: 'met', reason: 'The title has none of the words to avoid.', quote: null };
}

function checkLocation(location: string, criteria: Criteria['location']): Checked {
  const { verdict, reason } = classifyLocation(location, criteria);
  if (verdict === 'in_scope') {
    return { outcome: 'met', reason: 'The location is in your search scope.', quote: null };
  }
  return { outcome: verdict === 'out_of_scope' ? 'unmet' : 'unknown', reason, quote: null };
}

/** The summary field a criterion compares with, or why it is unknown. */
function summaryField(
  summary: JobToCheck['summary'],
  key: 'languages' | 'employmentType',
  label: string,
): SummaryFieldValue | Checked {
  const unknown = (reason: string): Checked => ({ outcome: 'unknown', reason, quote: null });
  if (summary === 'none') return unknown('The app does not have the job text yet.');
  if (summary === 'unsummarised') return unknown(`Summarise the job to find its ${label}.`);
  const field = summary[key];
  if (!field) return unknown(`The job text does not state its ${label}.`);
  if (!field.quoteVerified) {
    return unknown(`The quote given for its ${label} is not in the job text.`);
  }
  return field;
}

// Language names, lowercase, from every two-letter code Node's ICU names, plus other names that
// job ads use. Names that mean the same language map to one.
const languageAliases = new Map<string, string>([
  ['mandarin', 'chinese'],
  ['mandarin chinese', 'chinese'],
  ['tagalog', 'filipino'],
  ['farsi', 'persian'],
]);
const languageNames = new Set<string>(['cantonese', 'sami', ...languageAliases.keys()]);
{
  const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const a of letters) {
    for (const b of letters) {
      const name = names.of(a + b);
      if (name && !name.includes('(')) languageNames.add(name.toLowerCase());
    }
  }
}
const anyLanguage = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...languageNames]
    .sort((a, b) => b.length - a.length)
    .map((name) => escape(name).replace(/\s+/g, '\\s+'))
    .join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
);

/** The language a name means, lowercase, or undefined when the app does not know the name. */
export function languageOf(name: string): string | undefined {
  const lower = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!languageNames.has(lower)) return undefined;
  return languageAliases.get(lower) ?? lower;
}

// Words that mark a language as optional in its part of the field.
const optional =
  /(?<![\p{L}])(?:plus|nice to have|advantage(?:ous)?|bonus|preferred|beneficial|asset|optional|desirable|appreciated|helpful|not required)(?![\p{L}])/iu;

const capitalise = (name: string) => name.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
const andList = (names: readonly string[]) => names.map(capitalise).join(' and ');

function checkLanguages(field: SummaryFieldValue, mine: readonly string[]): Checked {
  const quote = field.quote;
  const required = new Set<string>();
  let named = false;
  for (const part of field.value.split(/[;,.()]/)) {
    const names = [...part.matchAll(anyLanguage)].map(([name]) => languageOf(name)!);
    named ||= names.length > 0;
    if (!optional.test(part)) names.forEach((name) => required.add(name));
  }
  if (!named) {
    return {
      outcome: 'unknown',
      reason: `Its working language, “${field.value}”, names no language the app recognises.`,
      quote,
    };
  }
  if (required.size === 0) {
    return {
      outcome: 'unknown',
      reason: `The job names only optional languages: “${field.value}”.`,
      quote,
    };
  }
  const user = new Set(mine.map((name) => languageOf(name) ?? name.toLowerCase()));
  const missing = [...required].filter((name) => !user.has(name));
  if (missing.length === 0) {
    return { outcome: 'met', reason: `It is done in ${andList([...required])}.`, quote };
  }
  if (missing.length === required.size) {
    return { outcome: 'unmet', reason: `It asks for ${andList(missing)}.`, quote };
  }
  return {
    outcome: 'unknown',
    reason: `It also asks for ${andList(missing)}; check whether that is needed.`,
    quote,
  };
}

const employmentPatterns: Record<EmploymentType, RegExp> = {
  full_time: /\bfull[\s-]?time\b/i,
  part_time: /\bpart[\s-]?time\b/i,
  permanent: /\b(?:permanent|open[\s-]ended|indefinite)\b/i,
  fixed_term: /\b(?:fixed[\s-]?term|temporary)\b/i,
  // A bare "contract" may be any of these, e.g. "permanent contract" or "6-month contract".
  contract: /\b(?:contractor|freelancer?|b2b|contract (?:role|position|basis|assignment|job))\b/i,
  internship: /\b(?:intern|internship|trainee|traineeship)\b/i,
};

const employmentLabels: Record<EmploymentType, string> = {
  full_time: 'full-time',
  part_time: 'part-time',
  permanent: 'permanent',
  fixed_term: 'fixed-term',
  contract: 'a contract role',
  internship: 'an internship',
};

// Hours and the kind of arrangement are separate questions: a job is usually one of each. Only the
// questions the user answered by accepting a type of it are checked.
const employmentDimensions: readonly (readonly EmploymentType[])[] = [
  ['full_time', 'part_time'],
  ['permanent', 'fixed_term', 'contract', 'internship'],
];

function checkEmploymentType(
  field: SummaryFieldValue,
  accepted: readonly EmploymentType[],
): Checked {
  const quote = field.quote;
  const named = (Object.keys(employmentPatterns) as EmploymentType[]).filter((type) =>
    employmentPatterns[type].test(field.value),
  );
  const describe = (types: readonly EmploymentType[]) =>
    types.map((type) => employmentLabels[type]).join(' and ');
  const unknown: string[] = [];
  for (const dimension of employmentDimensions) {
    const wanted = dimension.filter((type) => accepted.includes(type));
    if (wanted.length === 0) continue;
    const stated = named.filter((type) => dimension.includes(type));
    if (stated.length === 0) {
      unknown.push(
        `The job text does not say whether it is ${wanted.map((t) => employmentLabels[t]).join(' or ')}.`,
      );
    } else if (stated.every((type) => !accepted.includes(type))) {
      return { outcome: 'unmet', reason: `It is ${describe(stated)}.`, quote };
    } else if (!stated.every((type) => accepted.includes(type))) {
      unknown.push(`It is ${describe(stated)}; check which applies.`);
    }
  }
  if (unknown.length) return { outcome: 'unknown', reason: unknown.join(' '), quote };
  return { outcome: 'met', reason: `It is ${describe(named)}.`, quote };
}

/**
 * Checks a job against the criteria that are not off, in the order of `Criteria`, and decides
 * the verdict from the hard ones.
 */
export function checkJob(
  job: JobToCheck,
  criteria: Criteria,
): { verdict: JobVerdict; criteria: CriterionResult[] } {
  const results: CriterionResult[] = [];
  const add = (
    criterion: CriterionResult['criterion'],
    { strength, ifUnknown }: { strength: CriterionStrength; ifUnknown?: IfUnknown },
    check: () => Checked,
  ) => {
    if (strength === 'off') return;
    const { outcome, reason, quote } = check();
    let effect: CriterionResult['effect'] = 'none';
    if (strength === 'hard' && outcome === 'unmet') effect = 'rules_out';
    if (strength === 'hard' && outcome === 'unknown') {
      effect = ifUnknown === 'rule_out' ? 'rules_out' : 'to_confirm';
    }
    results.push({ criterion, strength, outcome, effect, reason, quote });
  };

  add('location', criteria.location, () => checkLocation(job.location, criteria.location));
  add('title', criteria.title, () => checkTitle(job.title, criteria.title.words));
  add('avoidInTitle', criteria.avoidInTitle, () =>
    checkAvoided(job.title, criteria.avoidInTitle.words),
  );
  add('languages', criteria.languages, () => {
    const field = summaryField(job.summary, 'languages', 'working language');
    return 'outcome' in field ? field : checkLanguages(field, criteria.languages.languages);
  });
  add('employmentType', criteria.employmentType, () => {
    const field = summaryField(job.summary, 'employmentType', 'employment type');
    return 'outcome' in field ? field : checkEmploymentType(field, criteria.employmentType.types);
  });
  add('mustHaves', criteria.mustHaves, () => job.mustHaves);

  const verdict: JobVerdict = results.some((r) => r.effect === 'rules_out')
    ? 'ineligible'
    : results.some((r) => r.effect === 'to_confirm')
      ? 'to_confirm'
      : 'eligible';
  return { verdict, criteria: results };
}
