import type { CriterionKey, CriterionResult } from '@jsa/shared';

export const criterionLabels: Record<CriterionKey, string> = {
  location: 'Location',
  title: 'Title',
  avoidInTitle: 'Words to avoid',
  languages: 'Working language',
  employmentType: 'Employment type',
  mustHaves: 'Must-haves',
};

/** One criterion's result in a sentence that says what it does to the job. */
export function describeResult(result: CriterionResult): string {
  const label = criterionLabels[result.criterion];
  if (result.effect === 'rules_out' && result.outcome === 'unknown') {
    return `${label} unknown, and you rule out unknowns: ${result.reason}`;
  }
  if (result.effect === 'to_confirm') return `${label} unknown: ${result.reason}`;
  if (result.strength === 'preference') return `${label} (preference): ${result.reason}`;
  return `${label}: ${result.reason}`;
}

/**
 * What the job list says about a job: the hard criteria that decide its group, and preferences
 * it is known not to meet. Unknown preferences are left to the job page.
 */
export function listedResults(results: readonly CriterionResult[]): CriterionResult[] {
  return results.filter(
    (r) => r.effect !== 'none' || (r.strength === 'preference' && r.outcome === 'unmet'),
  );
}
