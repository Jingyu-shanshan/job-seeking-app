import type {
  FillField,
  FillTaskStatus,
  FormFill,
  PageBlocker,
  PageField,
  PreviewField,
  PreviewFieldState,
} from '@jsa/shared';

// Filling a job's form with the local runner (T17). The runner puts in only the answers
// rules/form-answers.ts gave when the user started the fill, and never submits. What a field of the
// page holds is compared here with what the runner put in, and that decides whether the runner
// stops and hands the window to the user. The user may type in the window: what they type is shown
// as theirs, never saved as an answer.

/** Every question of the form, with what the runner puts in: only filled questions get a value. */
export function fillFields(fills: readonly FormFill[]): FillField[] {
  return fills.map((f) => ({
    key: f.question.key,
    label: f.question.label,
    kind: f.question.kind,
    group: f.question.group,
    required: f.question.required,
    answer: f.status === 'filled' ? f.answer : [],
    source: f.status === 'filled' ? f.source : null,
    documentPdfId: f.status === 'filled' ? f.documentPdfId : null,
  }));
}

const quoted = (labels: readonly string[], max = 5) => {
  const shown = labels.slice(0, max).map((label) => {
    const line = label.trim().replace(/\s+/g, ' ');
    return `“${line.length > 80 ? `${line.slice(0, 79)}…` : line}”`;
  });
  return labels.length > max
    ? `${shown.join(', ')} and ${labels.length - max} more`
    : shown.join(', ');
};

/**
 * Why the runner may not fill these answers in, or null. Every required question the app knows
 * needs an answer in the app first (user decision, 2026-10-07), so that what goes into the form is
 * recorded there.
 */
export function cannotFill(fills: readonly FormFill[]): string | null {
  const open = fills.filter((f) => f.status === 'needs_answer').map((f) => f.question.label);
  return open.length ? `Answer these questions first: ${quoted(open)}.` : null;
}

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');
const sameValues = (a: readonly string[], b: readonly string[]) => {
  const x = a.map(tidy).sort();
  const y = b.map(tidy).sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
};

/** What the page shows for a field the runner filled: a checked box for a consent. */
const expected = (field: FillField) => (field.kind === 'consent' ? ['checked'] : field.answer);

function stateOf(field: FillField | undefined, value: readonly string[]): PreviewFieldState {
  const empty = value.every((v) => tidy(v) === '');
  if (field?.answer.length) {
    if (sameValues(value, expected(field))) return 'as_filled';
    return empty ? 'empty' : 'changed';
  }
  return empty ? 'left_empty' : 'from_window';
}

/**
 * Each field of the page with what it holds compared with what the runner put in, in the page's
 * order; then the questions the runner had answers for that the page does not show.
 */
export function previewFields(
  fields: readonly FillField[],
  page: readonly PageField[],
): PreviewField[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const shown = page.map((p): PreviewField => {
    const field = byKey.get(p.key);
    const value = p.value.filter((v) => tidy(v) !== '');
    return {
      key: p.key,
      label: tidy(p.label) || field?.label || p.key,
      required: p.required || (field?.required ?? false),
      value,
      appAnswer: field?.answer ?? [],
      source: field?.source ?? null,
      state: stateOf(field, value),
    };
  });
  const onPage = new Set(page.map((p) => p.key));
  const missing = fields
    .filter((f) => f.answer.length && !onPage.has(f.key))
    .map((f): PreviewField => ({
      key: f.key,
      label: f.label,
      required: f.required,
      value: [],
      appAnswer: f.answer,
      source: f.source,
      state: 'missing',
    }));
  return [...shown, ...missing];
}

/** The fields the user should look at in the window, grouped by what is wrong with them. */
export function problems(preview: readonly PreviewField[]): string[] {
  const labels = (keep: (f: PreviewField) => boolean) => preview.filter(keep).map((f) => f.label);
  const groups: [string, string[]][] = [
    [
      'required and empty',
      labels((f) => f.required && (f.state === 'empty' || f.state === 'left_empty')),
    ],
    [
      'not what the app filled in',
      labels((f) => f.state === 'changed' || (!f.required && f.state === 'empty')),
    ],
    ['not found on the page', labels((f) => f.state === 'missing')],
  ];
  return groups.filter(([, list]) => list.length).map(([what, list]) => `${what}: ${quoted(list)}`);
}

const blockerMessages: Record<PageBlocker, string> = {
  captcha:
    'The page asks you to prove you are not a robot. The runner never does that: do it yourself in the browser window, then press Continue.',
  login:
    'The page asks you to sign in. The runner keeps no passwords: sign in yourself in the browser window if you want to go on, then press Continue.',
};

/**
 * Where a look at the form leaves the fill. Something only the user may deal with pauses it. Right
 * after the runner filled the form, so does any field that is empty although required, holds
 * something other than what the runner put in, or is not on the page. After the user's Continue
 * the form is taken as it is: the user has looked at the window, and the preview shows every
 * difference.
 */
export function checkOutcome(
  preview: readonly PreviewField[],
  blocker: PageBlocker | null,
  filledNow: boolean,
): { status: 'paused' | 'filled'; message: string } {
  if (blocker) return { status: 'paused', message: blockerMessages[blocker] };
  const found = problems(preview);
  if (filledNow && found.length) {
    return {
      status: 'paused',
      message: `Check these in the browser window, then press Continue. ${found
        .map((p) => `${p[0]!.toUpperCase()}${p.slice(1)}.`)
        .join(' ')}`,
    };
  }
  return {
    status: 'filled',
    message: `Nothing has been sent to the company.${
      found.length ? ' Some fields are not as the app filled them in.' : ''
    }`,
  };
}

/**
 * What can happen to a fill: the runner takes it, sends a look at the form (`check`, which goes to
 * paused or filled), fails, or reports its window closed; the user continues it after acting in the
 * window, or closes it.
 */
export type FillEvent = 'claim' | 'check' | 'fail' | 'window_closed' | 'continue' | 'close';

const open: FillTaskStatus[] = ['filling', 'paused', 'filled'];

const allowed: Record<FillEvent, readonly FillTaskStatus[]> = {
  claim: ['waiting'],
  check: ['filling'],
  fail: open,
  window_closed: open,
  continue: ['paused', 'filled'],
  close: ['waiting', ...open],
};

/** Whether `event` may happen to a fill in `status`. */
export function canHappen(status: FillTaskStatus, event: FillEvent): boolean {
  return allowed[event].includes(status);
}
