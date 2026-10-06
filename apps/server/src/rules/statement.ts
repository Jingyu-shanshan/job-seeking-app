import type { DraftAbout, FactKind, Problem, ProblemCode } from '@jsa/shared';
import { sensitiveData } from './facts.ts';
import { quoteFinder } from './quote.ts';

// The deterministic checks of a draft statement (T07). A statement about the job seeker may say
// only what the facts it cites say: every number, month, name and status word in it must be in
// those facts. A statement about the job may say only what its quote from the job text says, and
// a connecting sentence of a cover letter says nothing checkable at all. Meaning is not checked:
// whether a rephrased sentence overstates a fact is for the user to read (T08).

export interface StatementInput {
  about: DraftAbout;
  text: string;
  quote: string | null;
  unsentRefs: readonly string[];
  /** The fact versions it cites; `usable` is whether each may still appear in documents. */
  facts: readonly { body: string; usable: boolean }[];
}

export interface StatementContext {
  jobText: string;
  /** The job title and company as captured, which any statement of a cover letter may name. */
  jobNames: string;
  /** Names known from the facts sent and the job text, from `vocabularyOf`. */
  vocabulary: ReadonlySet<string>;
}

const tidy = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-');

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const has = (haystack: string, needle: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);

// ---------- months ----------

const monthNames = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const monthWord =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const monthYear = new RegExp(`\\b(${monthWord})\\.?,?\\s+(\\d{4})\\b`, 'gi');
const yearMonth = /\b(\d{4})[-/.](\d{1,2})\b/g;
const monthSlashYear = /\b(\d{1,2})[/.](\d{4})\b/g;

// ---------- numbers ----------

type Qualifier = 'none' | 'approx' | 'lower' | 'upper';

const wordNumbers = new Map<string, number>([
  ...'two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
    .split(' ')
    .map((word, i) => [word, i + 2] as const),
  ...'thirty forty fifty sixty seventy eighty ninety'
    .split(' ')
    .map((word, i) => [word, (i + 3) * 10] as const),
  ['hundred', 100],
  ['dozen', 12],
]);

const numberPattern = new RegExp(
  `(?<![\\p{L}\\p{N}_.,])(?:(\\d{1,3}(?:,\\d{3})+|\\d+(?:[.,]\\d+)?)(\\+?)|(${[...wordNumbers.keys()].join('|')}))(?![\\p{L}\\p{N}_])`,
  'giu',
);

const qualifier = (words: string) => new RegExp(`(?<!\\p{L})(?:${words})\\s*$`, 'iu');

const qualifierBefore: [Exclude<Qualifier, 'none'>, RegExp][] = [
  ['approx', qualifier('about|approximately|approx\\.?|around|roughly|nearly|almost|circa|~')],
  ['lower', qualifier('over|more than|at least|above|upwards of|>')],
  ['upper', qualifier('up to|less than|fewer than|under|below|at most|<')],
];

interface NumberUse {
  value: string;
  qualifier: Qualifier;
  /** As written, with its qualifier. */
  phrase: string;
}

function numbersIn(text: string): NumberUse[] {
  return [...text.matchAll(numberPattern)].map((m) => {
    const [whole, digits, plus, word] = m;
    const value = word
      ? String(wordNumbers.get(word.toLowerCase()))
      : String(
          Number(
            /^\d{1,3}(?:,\d{3})+$/.test(digits!)
              ? digits!.replaceAll(',', '')
              : digits!.replace(',', '.'),
          ),
        );
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    const found = qualifierBefore.find(([, pattern]) => pattern.test(before));
    const percent = text.charAt(m.index + whole.length) === '%' ? '%' : '';
    const written = `${whole}${percent}`;
    return {
      value,
      qualifier: plus ? 'lower' : (found?.[0] ?? 'none'),
      phrase: found ? `${before.match(found[1])![0]}${written}`.trim() : written,
    };
  });
}

/** May a statement use a number with this qualifier when its source uses it with these? */
function qualifierAllowed(used: Qualifier, source: readonly Qualifier[]): boolean {
  switch (used) {
    case 'none':
    case 'lower':
      return source.includes(used);
    case 'approx':
    case 'upper':
      return source.includes(used) || source.includes('none');
  }
}

// The month of a numeric date is checked as a month, not as a number.
const withoutMonths = (text: string) => text.replace(yearMonth, '$1').replace(monthSlashYear, '$2');

function numberProblems(text: string, source: string, where: string): Problem[] {
  const available = new Map<string, NumberUse[]>();
  for (const use of numbersIn(withoutMonths(source))) {
    available.set(use.value, [...(available.get(use.value) ?? []), use]);
  }
  const problems: Problem[] = [];
  for (const use of numbersIn(withoutMonths(text))) {
    const uses = available.get(use.value);
    if (!uses) {
      problems.push({ code: 'number', message: `“${use.phrase}” is not in ${where}.` });
    } else if (
      !qualifierAllowed(
        use.qualifier,
        uses.map((u) => u.qualifier),
      )
    ) {
      problems.push({
        code: 'qualifier',
        message: `“${use.phrase}” claims more than “${uses[0]!.phrase}” in ${where}.`,
      });
    }
  }
  return problems;
}

// ---------- month checks ----------

function monthsIn(text: string): { key: string; phrase: string }[] {
  const found: { key: string; phrase: string }[] = [];
  const add = (year: string, month: number, phrase: string) => {
    if (month >= 1 && month <= 12) found.push({ key: `${year}-${month}`, phrase });
  };
  for (const m of text.matchAll(monthYear)) {
    add(m[2]!, monthNames.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, m[0]);
  }
  for (const m of text.matchAll(yearMonth)) add(m[1]!, Number(m[2]), m[0]);
  for (const m of text.matchAll(monthSlashYear)) add(m[2]!, Number(m[1]), m[0]);
  return found;
}

function monthProblems(text: string, source: string, where: string): Problem[] {
  const available = new Set(monthsIn(source).map((m) => m.key));
  return monthsIn(text)
    .filter((m) => !available.has(m.key))
    .map((m) => ({ code: 'date', message: `“${m.phrase}” is not in ${where}.` }));
}

// ---------- names ----------

const notNames = new Set(['I', "I'm", "I've", "I'd", "I'll"]);
const isMonth = (word: string) => new RegExp(`^(?:${monthWord})\\.?$`, 'i').test(word);
const ordinaryWord = /^\p{Lu}[\p{Ll}']*$/u;
const abbreviation = /^(?:e\.g|i\.e|etc)\.?$/i;

interface Word {
  word: string;
  /** First word of a sentence, line or list item, where ordinary words are capitalised too. */
  initial: boolean;
}

const sentenceEnd = /(?<=[.!?])\s+|\n+/;

/** The words of a text, split at sentence ends (or `boundary`), line breaks and list markers. */
function wordsOf(text: string, boundary = sentenceEnd): Word[] {
  const words: Word[] = [];
  for (const sentence of tidy(text).split(boundary)) {
    const tokens = sentence.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').split(/\s+/);
    tokens.forEach((token, i) => {
      const word = token
        .replace(/^[("'[]+/, '')
        .replace(/[)"',.;:!?\]]+$/, '')
        .replace(/'s$/i, '');
      word
        .split(/[/-]/)
        .filter((part) => part !== '')
        .forEach((part, j) => words.push({ word: part, initial: i === 0 && j === 0 }));
    });
  }
  return words;
}

/** Whether a word names something a source must back: a product, a tool, a place, a company. */
function isName({ word, initial }: Word, vocabulary: ReadonlySet<string>): boolean {
  if (notNames.has(word) || isMonth(word) || abbreviation.test(word)) return false;
  const letters = /\p{L}/u.test(word);
  if (letters && /\d/.test(word)) return true;
  if (letters && /[+#]/.test(word)) return true;
  if (/\p{L}\.\p{L}/u.test(word)) return true;
  if (!/\p{Lu}/u.test(word)) return false;
  return initial && ordinaryWord.test(word) ? vocabulary.has(word) : true;
}

const pluralOf = (word: string, source: string) =>
  (/es$/i.test(word) && has(source, word.slice(0, -2))) ||
  (/s$/i.test(word) && word.length > 2 && has(source, word.slice(0, -1)));

function nameProblems(
  text: string,
  source: string,
  where: string,
  vocabulary: ReadonlySet<string>,
  allowed: ReadonlySet<string> = new Set(),
): Problem[] {
  const missing = new Set<string>();
  for (const word of wordsOf(text)) {
    if (!isName(word, vocabulary) || allowed.has(word.word)) continue;
    if (has(source, word.word) || pluralOf(word.word, source)) continue;
    missing.add(word.word);
  }
  return [...missing].map((name) => ({ code: 'term', message: `“${name}” is not in ${where}.` }));
}

// Words a job text capitalises at the start of headings, sentences and list items; never names.
const commonWords = new Set(
  `A An And Are As At About Be By For From How If In Is It Of On Or Our That The This To Us We What
  When Where Who Why Will With You Your Ability Background Bachelor Bonus Build Collaborate
  Comfortable Degree Design Develop Drive Ensure Excellent Experience Experienced Familiarity
  Fluency Fluent Good Great Hands Help Interest Join Knowledge Lead Maintain Must Nice Own Passion
  Passionate Plus Preferred Previous Prior Proficiency Proficient Proven Required Solid Strong
  Support Track Understanding Work Working Write`.split(/\s+/),
);

const clauseEnd = /(?<=[.!?:;])\s+|\n+/;

/**
 * The names the facts sent and the job text use, so that a statement cannot slip one in by
 * putting it first in a sentence, where every word is capitalised. Counted are words that look
 * technical (AWS, TypeScript), words capitalised in mid-sentence, every capitalised word of skill
 * and language facts (often bare lists), and words that start a sentence or list item of the job
 * text and never appear in lower case (a list item “Kubernetes in production”). A short line
 * without commas that capitalises every word is a heading and adds only technical words.
 */
export function vocabularyOf(
  facts: readonly { kind: FactKind; body: string }[],
  jobText: string,
): Set<string> {
  const vocabulary = new Set<string>();
  const lowercase = new Set(
    [jobText, ...facts.map((fact) => fact.body)]
      .flatMap((text) => wordsOf(text, clauseEnd))
      .map((w) => w.word)
      .filter((word) => word === word.toLowerCase()),
  );
  const technical = (word: string) => /\p{Lu}/u.test(word) && !ordinaryWord.test(word);
  const addFrom = (text: string, starts: 'all' | 'unless lower case' | 'none') => {
    for (const line of tidy(text).split(clauseEnd)) {
      const words = wordsOf(line, clauseEnd);
      const heading =
        starts !== 'all' &&
        !line.includes(',') &&
        words.length > 1 &&
        words.length <= 8 &&
        words.every((w) => /^\p{Lu}/u.test(w.word) || /^\P{L}*$/u.test(w.word));
      for (const { word, initial } of words) {
        if (!/\p{Lu}/u.test(word) || commonWords.has(word) || notNames.has(word)) continue;
        const counts =
          technical(word) ||
          (!heading &&
            (!initial ||
              starts === 'all' ||
              (starts === 'unless lower case' && !lowercase.has(word.toLowerCase()))));
        if (counts) vocabulary.add(word);
      }
    }
  };
  for (const fact of facts) {
    addFrom(fact.body, fact.kind === 'skill' || fact.kind === 'language' ? 'all' : 'none');
  }
  addFrom(jobText, 'unless lower case');
  return vocabulary;
}

// ---------- status words, sensitive data, placeholders ----------

// Words that limit what a fact claims. Leaving one out makes the statement claim more.
const statusWords = [
  'expected',
  'in progress',
  'ongoing',
  'pursuing',
  'currently studying',
  'currently learning',
  'not completed',
  'unfinished',
  'incomplete',
  'basic',
  'beginner',
  'elementary',
  'intermediate',
  'conversational',
  'familiar with',
  'exposure to',
  'A1',
  'A2',
  'B1',
  'B2',
];

function statusProblems(text: string, facts: readonly { body: string }[]): Problem[] {
  const dropped = new Set<string>();
  for (const { body } of facts) {
    for (const word of statusWords) {
      if (has(body, word) && !has(text, word)) dropped.add(word);
    }
  }
  return [...dropped].map((word) => ({
    code: 'status',
    message: `A fact it cites says “${word}”; the statement leaves that out.`,
  }));
}

const sensitiveWords =
  /\b(?:(?:work|residence) permits?|visas?|citizen(?:ship)?s?|sponsorship|salary|salaries|pay expectations?|work authori[sz]ation|right to work)\b/i;

const placeholder = /\[[^\]]*\]|\{\{|\}\}|\bTODO\b|\bTBD\b|lorem ipsum/i;
// The refs of the request, such as F3, which the user never sees.
const ref = /(?<![\p{L}\p{N}])F\d{1,3}(?![\p{L}\p{N}])/u;

function textProblems(text: string): Problem[] {
  const problems: Problem[] = [];
  // On the text as written: tidying turns dashes into hyphens, which phone numbers also have.
  if (sensitiveData(text).length) {
    problems.push({
      code: 'sensitive',
      message:
        'It contains an email address or a phone number; the app adds contact details itself.',
    });
  }
  if (sensitiveWords.test(text)) {
    problems.push({
      code: 'sensitive',
      message:
        'Work permits, visas, citizenship and salary go only into application forms that ask for them.',
    });
  }
  if (placeholder.test(text) || ref.test(text)) {
    problems.push({
      code: 'placeholder',
      message: 'It has a placeholder or a reference meant for the app instead of text.',
    });
  }
  return problems;
}

// ---------- the check ----------

// Words a cover letter's connecting sentences may capitalise without naming anything.
const letterWords = new Set(
  'Dear Hiring Manager Managers Team Recruiter Recruiting Recruitment Sincerely Regards Kind Best Yours Thank Thanks'.split(
    ' ',
  ),
);

const problem = (code: ProblemCode, message: string): Problem => ({ code, message });

/** Why a statement may not go into the document, each reason once; empty when it passes. */
export function statementProblems(statement: StatementInput, context: StatementContext): Problem[] {
  const seen = new Set<string>();
  return checkStatement(statement, context).filter(
    (p) => !seen.has(p.message) && seen.add(p.message),
  );
}

function checkStatement(
  statement: StatementInput,
  { jobText, jobNames, vocabulary }: StatementContext,
): Problem[] {
  const problems = textProblems(statement.text);
  const text = tidy(statement.text);

  if (statement.about === 'other') {
    const where = 'the job title or the company, and a connecting sentence cites nothing';
    return [
      ...problems,
      ...numberProblems(text, tidy(jobNames), where),
      ...nameProblems(text, tidy(jobNames), where, vocabulary, letterWords),
    ];
  }

  if (statement.about === 'job') {
    if (!statement.quote)
      return [...problems, problem('uncited', 'It does not quote the job text.')];
    if (quoteFinder(jobText)(statement.quote) < 0) {
      return [...problems, problem('quote_not_found', 'Its quote is not in the job text.')];
    }
    const source = tidy(`${statement.quote}\n${jobNames}`);
    const where = 'its quote from the job text';
    return [
      ...problems,
      ...numberProblems(text, source, where),
      ...monthProblems(text, source, where),
      ...nameProblems(text, source, where, vocabulary),
    ];
  }

  if (statement.unsentRefs.length) {
    problems.push(problem('unsent_fact', 'It cites facts that were not sent with the request.'));
  }
  if (statement.facts.length === 0) {
    return statement.unsentRefs.length
      ? problems
      : [...problems, problem('uncited', 'It cites none of your facts.')];
  }
  if (statement.facts.some((fact) => !fact.usable)) {
    problems.push(
      problem('fact_changed', 'A fact it cites has changed, or may no longer appear in documents.'),
    );
  }
  const source = tidy(statement.facts.map((fact) => fact.body).join('\n'));
  const where = 'the facts it cites';
  return [
    ...problems,
    ...numberProblems(text, source, where),
    ...monthProblems(text, source, where),
    ...nameProblems(text, source, where, vocabulary),
    ...statusProblems(
      text,
      statement.facts.map((fact) => ({ body: tidy(fact.body) })),
    ),
  ];
}

const squash = (text: string) => tidy(text).replace(/\s+/g, ' ').trim();

/** Whether the statement is one of its facts word for word, so nothing in it is DeepSeek's. */
export function isVerbatim(text: string, facts: readonly { body: string }[]): boolean {
  const own = squash(text);
  return facts.some((fact) => squash(fact.body) === own);
}
