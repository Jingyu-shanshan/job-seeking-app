import type {
  SavePageRequest,
  SavePageResponse,
  SaveResultsRequest,
  SaveResultsResponse,
  SavedEntry,
} from '@jsa/shared';
import type { PageReading, ResultsReading, Site } from './readers.ts';

// Turns what a reader read from a page (readers.ts) into a request to the app, and the app's
// answer into a line for the toolbar. A reading is the third-party page's content: its shape is
// checked here, and nothing but the fields below is sent. Which text a job page saves was
// decided by the user on 2026-10-02: on LinkedIn the job's description, since a signed-in page
// also shows the user's own name and profile hints; elsewhere the selected text, or the whole
// visible page when nothing is selected.

export const maxTextLength = 100_000;

const linkedInJob = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;

/** The site whose reader applies to a page address, if any. */
export function siteOf(url: string): Site | null {
  try {
    const { protocol, hostname } = new URL(url);
    const linkedIn = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
    return protocol === 'https:' && linkedIn ? 'linkedin' : null;
  } catch {
    return null;
  }
}

export type Saving<T> = { request: T; saved: string } | { error: string };

const isString = (value: unknown): value is string => typeof value === 'string';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cut = (text: string, length: number) => text.replace(/\s+/g, ' ').trim().slice(0, length);

function checkReading(value: unknown): PageReading | undefined {
  if (!isRecord(value)) return undefined;
  const { title, selection, text, jsonLd, job } = value;
  if (![title, selection, text].every(isString)) return undefined;
  if (!Array.isArray(jsonLd) || !jsonLd.every(isString)) return undefined;
  if (job !== null) {
    if (!isRecord(job) || ![job.title, job.company, job.location, job.text].every(isString)) {
      return undefined;
    }
  }
  return value as unknown as PageReading;
}

/** The request that saves a job page, or why it cannot be saved. */
export function jobPageRequest(url: string, value: unknown): Saving<SavePageRequest> {
  if (!url.startsWith('https://')) return { error: 'Only pages opened over https can be saved.' };
  const reading = checkReading(value);
  if (!reading) return { error: 'The page could not be read.' };
  const site = siteOf(url);

  let text: string;
  let saved: string;
  if (site && reading.job) {
    [text, saved] = [reading.job.text, 'the job’s description'];
  } else if (reading.selection) {
    [text, saved] = [reading.selection, 'the text you selected'];
  } else if (site) {
    return {
      error:
        'The app could not find the job’s description on this page. Select the job’s text, then press Save this job again.',
    };
  } else {
    [text, saved] = [reading.text, 'the whole visible page'];
  }
  text = text.trim();
  if (text === '') return { error: 'The page has no text to save.' };
  if (text.length > maxTextLength) {
    return {
      error: `The text is longer than ${maxTextLength.toLocaleString('en')} characters. Select only the job’s text, then save again.`,
    };
  }

  const described = site ? {} : jobPostingOf(reading.jsonLd);
  const title =
    cut(reading.job?.title ?? '', 1000) ||
    cut(described.title ?? '', 1000) ||
    cut(reading.title.replace(/^\(\d+\+?\)\s*/, ''), 1000) ||
    new URL(url).hostname;
  const company = cut(reading.job?.company || described.company || '', 1000);
  const location = cut(reading.job?.location || described.location || '', 5000);
  return {
    request: {
      url,
      title,
      text,
      ...(company ? { company } : {}),
      ...(location ? { location } : {}),
    },
    saved,
  };
}

/** The request that saves the job entries a results page shows, or why there is nothing. */
export function resultsRequest(
  value: unknown,
): Saving<SaveResultsRequest> & { unreadable: number } {
  if (!isRecord(value) || !Array.isArray(value.entries) || typeof value.unreadable !== 'number') {
    return { error: 'The page could not be read.', unreadable: 0 };
  }
  const { unreadable } = value as unknown as ResultsReading;
  const entries: SavedEntry[] = [];
  for (const entry of value.entries as unknown[]) {
    if (
      !isRecord(entry) ||
      ![entry.id, entry.title, entry.company, entry.location].every(isString)
    ) {
      continue;
    }
    const id = entry.id as string;
    const title = cut(entry.title as string, 1000);
    if (!/^\d{1,20}$/.test(id) || !title) continue;
    const company = cut(entry.company as string, 1000);
    const location = cut(entry.location as string, 5000);
    entries.push({
      url: linkedInJob(id),
      title,
      ...(company ? { company } : {}),
      ...(location ? { location } : {}),
    });
  }
  const skipped = unreadable + (value.entries.length - entries.length);
  if (entries.length === 0) {
    return {
      error:
        skipped > 0
          ? `The app could not read the ${plural(skipped, 'job entry', 'job entries')} on this page. Scroll to them so they load, or open each job and use Save this job.`
          : 'The app found no job entries on this page.',
      unreadable: skipped,
    };
  }
  if (entries.length > 100) {
    return { error: 'The app saves at most 100 jobs from one page.', unreadable: skipped };
  }
  return { request: { entries }, saved: plural(entries.length, 'job'), unreadable: skipped };
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The toolbar line after a job page was saved. */
export function pageSavedMessage(answer: SavePageResponse, saved: string): string {
  const title = `“${answer.title}”`;
  if (answer.newJob) return `Saved ${title}, with ${saved}.`;
  if (answer.text === 'first') return `Saved the text of ${title}, with ${saved}.`;
  if (answer.text === 'new') return `Saved a new version of ${title}, with ${saved}.`;
  return `${title} was already saved with this text.`;
}

/** The toolbar line after the entries of a results page were saved. */
export function resultsSavedMessage(answer: SaveResultsResponse, unreadable: number): string {
  let line = `Saved ${plural(answer.saved, 'job')} from this page, ${answer.newJobs} of them new. They need their job text before they are summarised.`;
  if (unreadable > 0) {
    line += ` ${plural(unreadable, 'entry', 'entries')} could not be read: scroll to them so they load, or open each job and use Save this job.`;
  }
  return line;
}

interface Described {
  title?: string;
  company?: string;
  location?: string;
}

const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/**
 * The job a page describes in its JSON-LD as a schema.org JobPosting: title, company and
 * location. Unreadable or missing parts are left out. The location is written the way the
 * app's location rule reads it: places separated by "; ", remote stated.
 */
export function jobPostingOf(blocks: readonly string[]): Described {
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const posting = findPosting(data);
    if (posting) return describe(posting);
  }
  return {};
}

function findPosting(data: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 3) return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findPosting(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  const type = data['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return data;
  return findPosting(data['@graph'], depth + 1);
}

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const nameOf = (value: unknown) =>
  isString(value) ? value : isRecord(value) && isString(value.name) ? value.name : '';

function countryName(value: unknown) {
  const name = nameOf(value).trim();
  return /^[A-Z]{2}$/.test(name) ? (regions.of(name) ?? name) : name;
}

function describe(posting: Record<string, unknown>): Described {
  const described: Described = {};
  const title = isString(posting.title) ? cut(posting.title, 1000) : '';
  if (title) described.title = title;
  const company = cut(nameOf(posting.hiringOrganization), 1000);
  if (company) described.company = company;

  const places = asList(posting.jobLocation).flatMap((place) => {
    const address = isRecord(place) ? place.address : undefined;
    if (!isRecord(address)) return [];
    const parts = [address.addressLocality, address.addressRegion]
      .filter(isString)
      .map((part) => part.trim());
    const country = countryName(address.addressCountry);
    const text = [...parts, country].filter((part) => part !== '').join(', ');
    return text ? [text] : [];
  });
  const remote = asList(posting.jobLocationType).some((t) => t === 'TELECOMMUTE');
  const from = asList(posting.applicantLocationRequirements)
    .map(countryName)
    .filter((name) => name !== '');
  if (remote) {
    places.push(from.length ? `Remote - ${from.join(', ')}` : 'Remote');
  }
  const location = cut(places.join('; '), 5000);
  if (location) described.location = location;
  return described;
}
