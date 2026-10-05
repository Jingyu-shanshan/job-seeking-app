// When two listings from different sites are the same job (T20): the same company and the same
// title, written the same way once case, accents, punctuation, spacing and a company's legal form
// are set aside. "HiQ Finland Oy" and "hiqfinland" are one company; "Full-Stack Engineer" and
// "Fullstack engineer" one title. Nothing else is guessed: abbreviations, translations and
// reworded titles stay different jobs. A key matches only when exactly one job has it, so two
// openings with the same title at one company are never merged.

// Legal forms dropped from the end of a company name.
const legalForms = new Set([
  'oy',
  'oyj',
  'ab',
  'abp',
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'llc',
  'gmbh',
  'ag',
  'as',
  'asa',
  'aps',
  'bv',
  'nv',
  'sa',
  'sas',
  'srl',
  'spa',
  'plc',
  'corp',
  'corporation',
  'co',
]);

function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function companyKey(company: string): string {
  const parts = words(company);
  while (parts.length > 1 && legalForms.has(parts.at(-1)!)) parts.pop();
  return parts.join('');
}

export function titleKey(title: string): string {
  return words(title).join('');
}

/** Location text compared the same way, for listings from one site. */
export function locationKey(location: string): string {
  return words(location).join('');
}

/** The key two listings of one job share; null without a company or a title to compare. */
export function sameJobKey(company: string | null, title: string): string | null {
  const c = company ? companyKey(company) : '';
  const t = titleKey(title);
  return c && t ? `${c}\u0000${t}` : null;
}

/**
 * Finds the one job each key belongs to among `candidates`: the job when exactly one has the key,
 * otherwise none.
 */
export function uniqueJobs(
  candidates: Iterable<{ key: string | null; jobId: string }>,
): Map<string, string | null> {
  const jobs = new Map<string, string | null>();
  for (const { key, jobId } of candidates) {
    if (key === null) continue;
    const known = jobs.get(key);
    if (known === undefined) jobs.set(key, jobId);
    else if (known !== jobId) jobs.set(key, null);
  }
  return jobs;
}
