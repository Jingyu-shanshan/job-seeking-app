import type { Job } from '@jsa/shared';

const verdictOrder = { eligible: 0, to_confirm: 1, ineligible: 2 };
const titleOrder = (job: Job) => {
  const title = job.criteria.find((result) => result.criterion === 'title');
  return title?.outcome === 'met' ? 0 : title?.outcome === 'unmet' ? 2 : 1;
};
const preferencesMet = (job: Job) =>
  job.criteria.filter((result) => result.strength === 'preference' && result.outcome === 'met')
    .length;

/** Role matches lead each eligibility group; preferences and recency break ties. */
export function compareJobs(a: Job, b: Job): number {
  return (
    verdictOrder[a.verdict] - verdictOrder[b.verdict] ||
    titleOrder(a) - titleOrder(b) ||
    preferencesMet(b) - preferencesMet(a) ||
    (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') ||
    b.firstSeenAt.localeCompare(a.firstSeenAt) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}
