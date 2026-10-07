import type { FormFill, FormQuestion, Profile } from '@jsa/shared';

// Which answer fills which question of an application form (T16). Only the user writes answers;
// these rules only choose among them, and a question none of them fits is the user's to answer,
// never guessed. In order: the user's answer for this job, a saved answer whose wording is the
// question's and whose places cover the job, the user's details, a kept PDF. A sensitive saved
// answer fills an optional question only when the user chose so for this job (user decision,
// 2026-10-07). Standard fields use Greenhouse's names (`email`, `resume`); other form adapters
// map their fields to the same names.

export interface SavedAnswerState {
  id: string;
  wordings: readonly string[];
  answer: readonly string[];
  sensitive: boolean;
  places: readonly string[];
}

export interface JobAnswerState {
  /** The question as it was asked when the user answered. */
  label: string;
  /** Null: fill this sensitive, optional question with the saved answer that fits it. */
  answer: readonly string[] | null;
}

export interface KeptPdf {
  id: string;
  fileName: string;
}

export interface FillContext {
  /** The job's location text, which a saved answer's places must name. */
  location: string;
  profile: Profile;
  saved: readonly SavedAnswerState[];
  /** The user's answers for this job, by question key. */
  jobAnswers: ReadonlyMap<string, JobAnswerState>;
  /** The current kept PDF of the job's latest resume and cover letter drafts. */
  documents: { resume: KeptPdf | null; cover_letter: KeptPdf | null };
}

/**
 * The wording of a question or an option as the rules compare it: case, accents' composed forms,
 * punctuation and spacing do not count, so “What’s your notice period?” is
 * “What's your notice period”.
 */
export function wordingKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether a job's location names one of `places` (all jobs when there are none). */
export function placesCover(places: readonly string[], location: string): boolean {
  if (places.length === 0) return true;
  const words = ` ${wordingKey(location)} `;
  return places.some((place) => {
    const key = wordingKey(place);
    return key !== '' && words.includes(` ${key} `);
  });
}

const sensitiveWords =
  /\b(salary|salaries|compensation|pay|wages?|remuneration|visas?|sponsor\w*|(work|residence|residency) permits?|right to work|authori[sz]ed to work|work authori[sz]ation|eligib\w* to work|citizen\w*|nationality|gender|sex|race|racial|ethnic\w*|veterans?|disabilit\w*|disabled|sexual orientation|religio\w*|date of birth|age|criminal|convict\w*)\b/i;

/**
 * Whether a question looks like it asks for something sensitive: work permits, salary or
 * self-identification. Only the default of the user's “Sensitive” choice when saving an answer.
 */
export function looksSensitive(question: FormQuestion): boolean {
  return selfIdentification(question) || sensitiveWords.test(question.label);
}

const selfIdentification = (question: FormQuestion) =>
  question.group === 'compliance' || question.group === 'demographic';

type Fitted = { ok: true; values: string[] } | { ok: false; reason: string };

/** Option `value` as the form words it, if it is exactly one of the options. */
function optionOf(options: readonly string[], value: string): string | undefined {
  const exact = options.find((option) => option === value.trim());
  if (exact) return exact;
  const same = options.filter((option) => wordingKey(option) === wordingKey(value));
  return same.length === 1 ? same[0] : undefined;
}

/** The answer as it goes into the form, or why it does not fit the question. */
export function fitAnswer(question: FormQuestion, answer: readonly string[]): Fitted {
  const values = answer.map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value === '')) {
    return { ok: false, reason: 'The answer is empty.' };
  }
  switch (question.kind) {
    case 'file':
      return { ok: false, reason: 'The app cannot attach this file.' };
    case 'consent':
      return values.length === 1 && values[0] === 'yes'
        ? { ok: true, values: ['Consent given'] }
        : { ok: false, reason: 'A consent is given or not given.' };
    case 'text':
    case 'textarea':
      if (values.length > 1) return { ok: false, reason: 'This question takes one answer.' };
      if (question.kind === 'text' && /[\r\n]/.test(values[0]!)) {
        return { ok: false, reason: 'This question takes one line.' };
      }
      return { ok: true, values };
    case 'single':
    case 'multi': {
      if (question.kind === 'single' && values.length > 1) {
        return { ok: false, reason: 'This question takes one of its options.' };
      }
      const chosen: string[] = [];
      for (const value of values) {
        const option = optionOf(question.options, value);
        if (!option) return { ok: false, reason: `“${value}” is not one of its options.` };
        if (!chosen.includes(option)) chosen.push(option);
      }
      return { ok: true, values: chosen };
    }
  }
}

function linkFor(label: string, links: readonly string[]): string | undefined {
  const site = /\blinkedin\b/i.test(label)
    ? 'linkedin.com'
    : /\bgithub\b/i.test(label)
      ? 'github.com'
      : undefined;
  if (!site) return undefined;
  return links.find((link) => {
    const host = new URL(link).hostname;
    return host === site || host.endsWith(`.${site}`);
  });
}

/** The user's detail that answers a standard question, with its name. */
function profileAnswer(question: FormQuestion, profile: Profile): [string, string] | undefined {
  if (question.kind !== 'text') return undefined;
  if (question.key === 'email' && profile.email) return [profile.email, 'email'];
  if (question.key === 'phone' && profile.phone) return [profile.phone, 'phone'];
  if (question.group === 'location' && question.key === 'location' && profile.location) {
    return [profile.location, 'where you live'];
  }
  const link = linkFor(question.label, profile.links);
  return link ? [link, 'links'] : undefined;
}

const documentNames = { resume: 'resume', cover_letter: 'cover letter' } as const;

const list = (items: readonly string[]) => items.map((item) => `“${item}”`).join(', ');

export function fillQuestion(question: FormQuestion, context: FillContext): FormFill {
  const mine = context.jobAnswers.get(question.key);
  const mineNow = mine && wordingKey(mine.label) === wordingKey(question.label) ? mine : undefined;
  const base = {
    question,
    answer: [] as string[],
    source: null,
    savedAnswerId: null,
    documentPdfId: null,
    sensitive: selfIdentification(question),
    answeredForJob: mine !== undefined,
    looksSensitive: looksSensitive(question),
  };
  const filled = (fill: Partial<FormFill> & Pick<FormFill, 'answer' | 'source' | 'note'>) => ({
    ...base,
    ...fill,
    status: 'filled' as const,
  });
  // Why nothing fills it, when there is a reason worth telling.
  let why = '';
  const unanswered = (extra: Partial<FormFill> = {}): FormFill => ({
    ...base,
    ...extra,
    status: question.required ? 'needs_answer' : 'optional_empty',
    note: why || (question.required ? 'Needs your answer.' : 'Optional: left empty.'),
  });

  if (mine && !mineNow) {
    why = `Your answer for this job was to an earlier wording: “${mine.label}”.`;
  } else if (mineNow?.answer) {
    const fitted = fitAnswer(question, mineNow.answer);
    if (fitted.ok)
      return filled({ answer: fitted.values, source: 'job', note: 'Your answer for this job.' });
    why = `Your answer for this job no longer fits: ${fitted.reason}`;
  }

  if (question.kind === 'consent') {
    // Each company asks for its own consent, so it is never saved for later.
    why ||= 'Give this consent for this application, or leave it.';
    return unanswered();
  }

  if (question.kind === 'file') {
    const kind = question.key === 'resume' || question.key === 'cover_letter' ? question.key : null;
    const pdf = kind && context.documents[kind];
    if (pdf) {
      return filled({
        answer: [pdf.fileName],
        source: 'document',
        documentPdfId: pdf.id,
        note: `The ${documentNames[kind]} PDF you kept for this job.`,
      });
    }
    why = kind
      ? `Keep a PDF of this job’s ${documentNames[kind]} on its document page.`
      : 'The app cannot attach this file; you attach it in the form yourself.';
    return unanswered();
  }

  const key = wordingKey(question.label);
  const worded = context.saved.filter((s) => s.wordings.some((w) => wordingKey(w) === key));
  const fitting = worded.filter((s) => placesCover(s.places, context.location));
  if (fitting.length > 1) {
    why ||= `${fitting.length} of your saved answers have this wording and fit this job. Answer it for this job, or change their places.`;
    return unanswered({ sensitive: base.sensitive || fitting.some((s) => s.sensitive) });
  }
  const saved = fitting[0];
  if (saved) {
    const sensitive = base.sensitive || saved.sensitive;
    const fitted = fitAnswer(question, saved.answer);
    if (!fitted.ok) {
      why ||= `Your saved answer does not fit this question: ${fitted.reason}`;
      return unanswered({ savedAnswerId: saved.id, sensitive });
    }
    if (sensitive && !question.required && !(mineNow && mineNow.answer === null)) {
      return {
        ...base,
        status: 'held_back',
        savedAnswerId: saved.id,
        sensitive,
        note: 'Sensitive and optional: left empty unless you choose to answer it for this job.',
      };
    }
    const scope = saved.places.length ? ` for jobs in ${saved.places.join(', ')}` : '';
    return filled({
      answer: fitted.values,
      source: 'saved',
      savedAnswerId: saved.id,
      sensitive,
      note: `Your saved answer${scope}.`,
    });
  }
  if (worded.length) {
    const places = [...new Set(worded.flatMap((s) => s.places))];
    why ||= `Your saved answer is only for jobs whose location names ${list(places)}; this job’s location${context.location ? ` “${context.location}”` : ''} names none of them.`;
  }

  const detail = profileAnswer(question, context.profile);
  if (detail) {
    return filled({
      answer: [detail[0]],
      source: 'profile',
      note: `From Your details: ${detail[1]}.`,
    });
  }
  return unanswered();
}

export function fillForm(questions: readonly FormQuestion[], context: FillContext): FormFill[] {
  return questions.map((question) => fillQuestion(question, context));
}
