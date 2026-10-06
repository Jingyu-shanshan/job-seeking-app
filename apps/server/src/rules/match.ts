import type { JobVerdict, Outcome } from '@jsa/shared';
import Type from 'typebox';
import { Value } from 'typebox/value';
import type { Checked } from './criteria.ts';

// Evidence matching (T06): DeepSeek compares a job's requirements with the facts the user allowed
// to be sent and answers, per requirement, met / unmet / unknown with the facts it rests on. The
// model only explains; this module decides what its answer may say and what it means now.

const OutcomeSchema = Type.Union([
  Type.Literal('met'),
  Type.Literal('unmet'),
  Type.Literal('unknown'),
]);

export const MatchAnswerSchema = Type.Object({
  requirements: Type.Array(
    Type.Object({
      ref: Type.String({ maxLength: 20 }),
      outcome: OutcomeSchema,
      facts: Type.Array(Type.String({ maxLength: 20 }), { maxItems: 50 }),
      note: Type.String({ maxLength: 1000 }),
    }),
    { maxItems: 200 },
  ),
});

export interface CheckedOutcome {
  outcome: Outcome;
  /** Refs of facts that were sent, each once. */
  facts: string[];
  note: string;
}

/**
 * Checks DeepSeek's answer against the refs that were sent: one outcome per requirement ref, in
 * the order sent, or undefined when the answer does not have the expected shape. Fact refs that
 * were not sent are dropped. Met or unmet without a fact that was sent is unknown: an outcome
 * rests on the user's facts or it is not known. A requirement the answer skips is unknown.
 */
export function checkMatchAnswer(
  answer: unknown,
  requirementRefs: readonly string[],
  factRefs: readonly string[],
): CheckedOutcome[] | undefined {
  if (!Value.Check(MatchAnswerSchema, answer)) return undefined;
  const sentFacts = new Set(factRefs);
  const byRef = new Map<string, CheckedOutcome>();
  for (const item of answer.requirements) {
    if (!requirementRefs.includes(item.ref) || byRef.has(item.ref)) continue;
    const facts = [...new Set(item.facts.filter((ref) => sentFacts.has(ref)))];
    const note = item.note.trim();
    byRef.set(
      item.ref,
      item.outcome !== 'unknown' && facts.length === 0
        ? {
            outcome: 'unknown',
            facts,
            note: `DeepSeek said ${item.outcome} but cited none of your facts, so it is unknown.`,
          }
        : { outcome: item.outcome, facts, note },
    );
  }
  return requirementRefs.map(
    (ref) =>
      byRef.get(ref) ?? {
        outcome: 'unknown',
        facts: [],
        note: 'DeepSeek gave no answer for this requirement.',
      },
  );
}

/**
 * The outcome a matched requirement has now: as matched while every fact version it cites is
 * still its fact's current, confirmed version; otherwise unknown until it is matched again.
 */
export function outcomeNow(
  matched: { outcome: Outcome; factVersionIds: readonly string[] },
  validFactVersions: ReadonlySet<string>,
): Outcome {
  return matched.factVersionIds.every((id) => validFactVersions.has(id))
    ? matched.outcome
    : 'unknown';
}

/** A match's verdict on the must-haves when it is made, stored with it. */
export function evidenceVerdict(mustHaves: readonly Outcome[]): JobVerdict {
  if (mustHaves.includes('unmet')) return 'ineligible';
  return mustHaves.every((outcome) => outcome === 'met') ? 'eligible' : 'to_confirm';
}

export interface MustHavesInput {
  hasText: boolean;
  /** Whether the text was summarised, or the user added requirements to it. */
  requirementsKnown: boolean;
  /** The text's must-haves whose quotes are in it and that were not removed. */
  mustHaves: readonly { id: string; text: string; quote: string }[];
  /** The latest match's outcomes by requirement id; undefined when it was never matched. */
  matched: ReadonlyMap<string, { outcome: Outcome; factVersionIds: readonly string[] }> | undefined;
  /** Current versions of confirmed facts. */
  validFactVersions: ReadonlySet<string>;
}

const listOf = (items: readonly { text: string }[]) => {
  const shown = items.slice(0, 3).map((item) => `“${item.text}”`);
  if (items.length > 3) shown.push(`${items.length - 3} more`);
  return shown.join(', ');
};

/** Whether the user's facts meet the job's must-haves, as the must-have criterion sees it. */
export function mustHavesOutcome({
  hasText,
  requirementsKnown,
  mustHaves,
  matched,
  validFactVersions,
}: MustHavesInput): Checked {
  const unknown = (reason: string, quote: string | null = null): Checked => ({
    outcome: 'unknown',
    reason,
    quote,
  });
  if (!hasText) return unknown('The app does not have the job text yet.');
  if (!requirementsKnown) return unknown('Summarise the job to find its must-haves.');
  if (mustHaves.length === 0) {
    return { outcome: 'met', reason: 'The job text names no must-haves.', quote: null };
  }
  if (!matched) return unknown('Not matched with your facts yet.');

  const now = mustHaves.map((requirement) => {
    const m = matched.get(requirement.id);
    return { ...requirement, outcome: m ? outcomeNow(m, validFactVersions) : 'unknown' };
  });
  const unmet = now.filter((r) => r.outcome === 'unmet');
  if (unmet.length) {
    return {
      outcome: 'unmet',
      reason: `Your facts do not meet ${listOf(unmet)}.`,
      quote: unmet[0]!.quote,
    };
  }
  const open = now.filter((r) => r.outcome === 'unknown');
  if (open.length) return unknown(`No evidence in your facts for ${listOf(open)}.`, open[0]!.quote);
  const n = mustHaves.length;
  return {
    outcome: 'met',
    reason: n === 1 ? 'Your facts meet its must-have.' : `Your facts meet all ${n} must-haves.`,
    quote: null,
  };
}

export const sameSet = (a: Iterable<string>, b: Iterable<string>) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

/** Why a match is out of date; empty when matching again would send the same request. */
export function matchOutdated({
  sentFacts,
  sendableFacts,
  matchedRequirements,
  currentRequirements,
}: {
  sentFacts: Iterable<string>;
  sendableFacts: Iterable<string>;
  matchedRequirements: Iterable<string>;
  currentRequirements: Iterable<string>;
}): string[] {
  const reasons: string[] = [];
  if (!sameSet(sentFacts, sendableFacts)) {
    reasons.push('The facts that may be sent to DeepSeek have changed since.');
  }
  if (!sameSet(matchedRequirements, currentRequirements)) {
    reasons.push('The requirements have changed since.');
  }
  return reasons;
}
