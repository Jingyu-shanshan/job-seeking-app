import type {
  ApplicationStatus,
  FillField,
  PageBlocker,
  PageField,
  PreviewField,
} from '@jsa/shared';
import { problems } from './fill.ts';

// Approving and submitting one job's application (T18). The user approves the form as the runner
// last read it. The approval binds that look's values, the job's text then current, and the fill's
// answers and PDFs; whatever changes voids it. Just before pressing Submit the runner reads the
// form once more, and the runner presses Submit only when that look has the approved values. One
// approval lets the runner press Submit once; a result the runner cannot see is left to the user.

/** The most applications that may go in (or may have gone in) in any 24 hours (user decision). */
export const dailyCap = 5;

const quoted = (labels: readonly string[], max = 5) => {
  const shown = labels.slice(0, max).map((label) => `“${label.trim().replace(/\s+/g, ' ')}”`);
  return labels.length > max
    ? `${shown.join(', ')} and ${labels.length - max} more`
    : shown.join(', ');
};

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');
const sameValues = (a: readonly string[], b: readonly string[]) => {
  const x = a.map(tidy).filter(Boolean).sort();
  const y = b.map(tidy).filter(Boolean).sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
};

/**
 * The questions whose answer or attached PDF differs between the fill and what the app would put
 * in now: a changed answer, document, form or detail.
 */
export function changedAnswers(fill: readonly FillField[], now: readonly FillField[]): string[] {
  const before = new Map(fill.map((f) => [f.key, f]));
  const after = new Map(now.map((f) => [f.key, f]));
  const changed: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key);
    const b = after.get(key);
    const same =
      a && b
        ? sameValues(a.answer, b.answer) && a.documentPdfId === b.documentPdfId
        : !(a ?? b)!.answer.length;
    if (!same) changed.push((b ?? a)!.label);
  }
  return changed;
}

/** The fields whose value differs between two looks at the form, by label. */
export function changedFields(approved: readonly PageField[], now: readonly PageField[]): string[] {
  const before = new Map(approved.map((f) => [f.key, f]));
  const after = new Map(now.map((f) => [f.key, f]));
  const changed: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key);
    const b = after.get(key);
    if (!sameValues(a?.value ?? [], b?.value ?? [])) changed.push(tidy((a ?? b)!.label) || key);
  }
  return changed;
}

export interface ApprovalFacts {
  /** The job's application that went in or may have, if any. */
  openApplication: Extract<ApplicationStatus, 'to_verify' | 'submitted'> | null;
  /** The job's current text. */
  snapshotId: string | null;
  /** The text the approval bound, once there is one. */
  approvedSnapshotId?: string;
  /** What the runner put in, and what the app would put in now (or why it cannot fill now). */
  fillFields: readonly FillField[];
  currentFields: readonly FillField[] | string;
  /** The latest look at the form. */
  blocker: PageBlocker | null;
  preview: readonly PreviewField[];
  submittedLastDay: number;
}

/**
 * Why the latest look at the filled form may not be approved (or the approval no longer holds),
 * or null. The look must show no blocker and no empty required field, the job text and the
 * answers must be what they were, the job must have no application that went in or may have, and
 * the last 24 hours must be under the cap.
 */
export function approvalProblem(facts: ApprovalFacts): string | null {
  if (facts.openApplication === 'submitted') {
    return 'This job’s application went in already.';
  }
  if (facts.openApplication === 'to_verify') {
    return 'The result of this job’s application is unknown. Say below whether it went through first.';
  }
  if (!facts.snapshotId) return 'The app has no text of this job, so there is nothing to bind.';
  if (facts.approvedSnapshotId && facts.approvedSnapshotId !== facts.snapshotId) {
    return 'The job’s text changed since you approved.';
  }
  if (typeof facts.currentFields === 'string') {
    return `The app would not fill this form now: ${facts.currentFields} Close this fill.`;
  }
  const changed = changedAnswers(facts.fillFields, facts.currentFields);
  if (changed.length) {
    return `Your answers or documents changed since the runner filled the form: ${quoted(changed)}. Close this fill and start another, so the form holds them.`;
  }
  if (facts.blocker) return 'The page asks for something only you can do in the window.';
  const empty = problems(facts.preview).find((p) => p.startsWith('required and empty'));
  if (empty)
    return `The form is not complete: ${empty}. Fill them in in the window and look again.`;
  if (facts.submittedLastDay >= dailyCap) {
    return `${facts.submittedLastDay} applications went in (or may have) in the last 24 hours, which is the most the app allows (${dailyCap}). Try again later.`;
  }
  return null;
}

/**
 * Why the runner may not press Submit after its last look before it, or null: a blocker, or a
 * field whose value is not the approved one.
 */
export function submitProblem(
  approved: readonly PageField[],
  now: readonly PageField[],
  blocker: PageBlocker | null,
): string | null {
  if (blocker) return 'The page asked for something only you can do just before Submit.';
  const changed = changedFields(approved, now);
  if (changed.length) {
    return `The form changed after you approved it: ${quoted(changed)}. Look at it again and approve it again if it is right.`;
  }
  return null;
}

/**
 * Whether `pageUrl` is Greenhouse's confirmation page for the form at `formUrl`. The page opens
 * without submitting too, so it counts only after the runner pressed Submit.
 */
export function isConfirmationPage(pageUrl: string | null, formUrl: string): boolean {
  if (!pageUrl) return false;
  try {
    const page = new URL(pageUrl);
    const form = new URL(formUrl);
    return (
      page.origin === form.origin &&
      page.pathname === '/embed/job_app/confirmation' &&
      page.searchParams.get('for') === form.searchParams.get('for') &&
      page.searchParams.get('token') === form.searchParams.get('token') &&
      page.searchParams.get('token') !== null
    );
  } catch {
    return false;
  }
}

/** What the job page says while the runner waits for the result of Submit. */
export const progressMessages = {
  captcha:
    'The runner pressed Submit and the page asks you to prove you are not a robot. Do it in the window and press Submit yourself if the page asks; the runner watches for the confirmation for up to 10 minutes.',
  security_code:
    'The runner pressed Submit and Greenhouse emailed you a security code. Type it in the window and press Submit yourself; the runner watches for the confirmation for up to 10 minutes.',
  form_errors:
    'The runner pressed Submit and the form shows fields it did not accept. Fix them in the window and press Submit yourself, or close the window; the runner watches for the confirmation for up to 10 minutes.',
  other:
    'The runner pressed Submit and waits for Greenhouse’s confirmation page, for up to 10 minutes.',
} as const;
