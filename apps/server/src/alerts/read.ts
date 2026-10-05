import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import { locationKey, sameJobKey } from '../rules/same-job.ts';
import type { AlertMessage } from './message.ts';

// Reads the jobs an alert email lists (T20). A job is a link the source's link rule recognises;
// the rule turns it into the job's own address and id, dropping the email's tracking and sign-in
// parameters. Most alert emails wrap their links in a click tracker; the address it leads to is
// often written in the link itself, as a parameter or base64-encoded (Mandrill, for one), and is
// decoded from there. Links are never followed and nothing is loaded: a job that only a request
// to the tracker would reveal is not read.
//
// Around each job's links the email shows a card. The source's card rule reads it from the job
// link's own text, the lines before the job's first link and the lines after it: most emails put
// the title in the link with the company and location below it, some put everything above a
// "Read more" link. An HTML part is read first, the text part only when the HTML part gives no job.
//
// Some emails link their one job only through a tracker that cannot be read (Snaphunt). A source
// can then read the job from the email's lines instead: it has no address, and is known by its
// company, title and location.

export interface JobLinkMatch {
  /** The job's page, rebuilt from its id. */
  url: string;
  /** The site's id for the job. */
  id: string;
}

/** Recognises a link to one job on the source's site. */
export type JobLink = (url: URL) => JobLinkMatch | undefined;

export interface Card {
  title: string;
  company: string | null;
  location: string;
  details: string;
}

/** What the email shows around one job. */
export interface CardLines {
  /** The text of a link to the job that reads as a title; '' when every link is an action or an image. */
  linkText: string;
  /** Every such text, in order; some emails link a whole card as well as its title. */
  linkTexts: string[];
  /** The lines before the job's first link, back to the previous job's last link or the start. */
  before: string[];
  /** The lines after the title link (or the first link), up to the next job or a link elsewhere. */
  after: string[];
}

/** Reads a job's card; null when the card has no title to read. */
export type CardRule = (lines: CardLines, message: AlertMessage) => Card | null;

export interface AlertEntry extends Card {
  /** Null for a job read without a link. */
  url: string | null;
  /** The site's id for the job, or for one read without a link, a hash of its company, title and location. */
  externalId: string;
}

export interface ReadResult {
  jobs: AlertEntry[];
  /** Jobs linked to whose title could not be read. */
  unreadable: number;
}

export interface Reader {
  jobLink: JobLink;
  card?: CardRule;
  /** Reads the jobs of an email whose links name none, from its lines; none by default. */
  unlinked?: (lines: string[], message: AlertMessage) => Card[];
}

const maxTitle = 300;
const maxDetails = 500;
// Lines of a card that are read on each side of its link.
const cardLines = 8;

// Link texts that are actions rather than a job's title: the whole text is one of these phrases,
// so that "Open Source Engineer" stays a title.
const actions =
  /^(?:(?:view|see|show|open)(?: (?:the |all )?(?:job|jobs|ad|details|more|position|vacancy))?|read more|more|details|apply(?: now)?|(?:send|edit) application|save(?: job)?|(?:click )?here|katso(?: lisää| ilmoitus| työpaikat)?|näytä(?: työpaikat| lisää)?|hae(?: nyt)?|lue lisää|avaa(?: ilmoitus)?|tästä|ansök(?: nu)?|visa(?: jobb)?|läs mer)\s*[→›»>.!:]*$/iu;

const blocks = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const skipped = new Set(['head', 'noscript', 'script', 'style', 'template', 'title']);
const hiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(?:px)?\s*(?:;|$))/i;

interface Line {
  text: string;
  /** The text of each link to a job on this line, by job address. */
  linked: Map<string, string[]>;
  /** Jobs linked from this line, with or without text (a logo, say). */
  jobs: Set<string>;
  /** True when the line is a link to something other than a job, such as "See all jobs". */
  navigation?: boolean;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The job a link points at, directly or through an address the link carries. */
function jobOf(href: string, jobLink: JobLink): JobLinkMatch | undefined {
  const match = linkedJob(href, jobLink);
  return match && match.url.length <= 2000 && match.id.length <= 200 ? match : undefined;
}

function linkedJob(href: string, jobLink: JobLink): JobLinkMatch | undefined {
  const url = parseUrl(href);
  if (!url) return undefined;
  const direct = jobLink(url);
  if (direct) return direct;
  for (const address of carriedAddresses(url)) {
    const inner = parseUrl(address);
    const carried = inner && jobLink(inner);
    if (carried) return carried;
  }
  return undefined;
}

/** An http or https address without a user name or password; an http one still names the job. */
function parseUrl(address: string): URL | undefined {
  try {
    const url = new URL(address.trim());
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

// Printable ASCII but for quotes, angle brackets and backslashes, which end an address.
const addressIn = /https?:\/\/[!#-&(-;=?-[\]-~]+/g;
const base64 = /^[A-Za-z0-9+/_~=-]{16,}$/;

/**
 * The addresses a tracking link carries: a parameter that is an address, or one written
 * base64-encoded in a parameter or a path segment, also inside JSON with escaped slashes.
 */
function carriedAddresses(url: URL): string[] {
  const found: string[] = [];
  for (const value of [...url.searchParams.values(), ...url.pathname.split('/')]) {
    if (/^https?:\/\//i.test(value)) {
      found.push(value);
      continue;
    }
    if (!base64.test(value)) continue;
    const standard = value.replace(/[-_~]/g, (c) => ({ '-': '+', _: '/', '~': '=' })[c]!);
    const decoded = Buffer.from(standard, 'base64').toString('latin1').replace(/\\+\//g, '/');
    for (const [address] of decoded.matchAll(addressIn)) found.push(address);
  }
  return found;
}

function htmlLines(html: string, jobLink: JobLink, ids: Map<string, string>): Line[] {
  const lines: Line[] = [];
  let line: Line = { text: '', linked: new Map(), jobs: new Set() };
  // The text of each link on the line being read, in order.
  let pieces: { job: string; link: number; text: string }[] = [];
  let otherLinked = '';
  const stack: { name: string; hidden: boolean; job?: string; link?: number; other?: boolean }[] =
    [];
  let links = 0;
  let hidden = 0;
  let skip = 0;

  const flush = () => {
    // An icon inside a line separates what it labels: "Acme · London · Permanent".
    const text = clean(line.text)
      .replace(/(?:\s*\u00b7\s*){2,}/g, ' \u00b7 ')
      .replace(/^\u00b7\s*|\s*\u00b7$/g, '');
    if (text || line.jobs.size) {
      const linked = new Map<string, string[]>();
      for (const piece of pieces) {
        const text = clean(piece.text);
        if (text) linked.set(piece.job, [...(linked.get(piece.job) ?? []), text]);
      }
      const navigation = !line.jobs.size && text !== '' && clean(otherLinked) === text;
      lines.push({ text, linked, jobs: line.jobs, ...(navigation ? { navigation } : {}) });
    }
    line = { text: '', linked: new Map(), jobs: new Set() };
    pieces = [];
    otherLinked = '';
  };
  const currentLink = () => stack.findLast((element) => element.job);
  const inOtherLink = () => stack.some((element) => element.other);

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const isHidden = hiddenStyle.test(attributes['style'] ?? '') || 'hidden' in attributes;
        let job: string | undefined;
        if (name === 'a' && attributes['href']) {
          const match = jobOf(attributes['href'], jobLink);
          if (match) {
            job = match.url;
            if (!ids.has(job)) ids.set(job, match.id);
          }
        }
        const other = name === 'a' && !job && !!attributes['href'];
        stack.push({
          name,
          hidden: isHidden,
          ...(job ? { job, link: (links += 1) } : {}),
          ...(other ? { other } : {}),
        });
        if (isHidden) hidden += 1;
        if (skipped.has(name)) skip += 1;
        if (blocks.has(name)) flush();
        if (job && hidden === 0 && skip === 0) line.jobs.add(job);
        if (name === 'img' && hidden === 0 && skip === 0) line.text += ' \u00b7 ';
      },
      ontext(text) {
        if (hidden > 0 || skip > 0) return;
        line.text += text;
        const link = currentLink();
        if (link?.job) {
          const last = pieces.at(-1);
          if (last && last.link === link.link) last.text += text;
          else pieces.push({ job: link.job, link: link.link!, text });
        } else if (inOtherLink()) otherLinked += text;
      },
      onclosetag(name) {
        const element = stack.pop();
        if (element?.hidden) hidden -= 1;
        if (skipped.has(name)) skip -= 1;
        if (blocks.has(name)) flush();
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  flush();
  return lines;
}

/**
 * Lines of a text part. A line with a job's address is that job's link; in text alerts the
 * address usually follows the job's lines, so the block of lines just before it (back to a blank
 * line, a separator or the previous job) becomes its card, with the first of them as the title.
 */
function textLines(text: string, jobLink: JobLink, ids: Map<string, string>): Line[] {
  const lines: Line[] = [];
  let card: string[] = [];
  // A blank line ends a block, unless the job's address comes right after it.
  let blank = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (/^[-=_*·•]{3,}$/.test(line)) {
      card = [];
      blank = false;
      continue;
    }
    if (!line) {
      blank = card.length > 0;
      continue;
    }
    const jobs = new Set<string>();
    for (const [address] of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      const match = jobOf(address, jobLink);
      if (match) {
        jobs.add(match.url);
        if (!ids.has(match.url)) ids.set(match.url, match.id);
      }
    }
    if (!jobs.size) {
      if (blank) card = [];
      blank = false;
      card.push(line);
      continue;
    }
    blank = false;
    const [title, ...rest] = card;
    const job = [...jobs][0]!;
    lines.push({ text: title ?? '', linked: new Map([[job, title ? [title] : []]]), jobs });
    for (const restLine of rest) lines.push({ text: restLine, linked: new Map(), jobs: new Set() });
    card = [];
  }
  return lines;
}

/** Company and location as `Company · Location · …`, or on two lines; the rest are details. */
export function companyAndLocation(lines: string[]): Omit<Card, 'title'> {
  const [first = '', ...rest] = lines;
  const parts = first.split(/\s+[·•|]\s+/);
  if (parts.length > 1) {
    return {
      company: parts[0] || null,
      location: parts[1]!,
      details: [...parts.slice(2), ...rest].join(' · '),
    };
  }
  const [second = '', ...more] = rest;
  return { company: first || null, location: second, details: more.join(' · ') };
}

/** The title is the link's text, the company and location follow it. */
export const defaultCard: CardRule = ({ linkText, after }) =>
  linkText ? { title: linkText, ...companyAndLocation(after) } : null;

const shown = (line: Line) => line.text !== '' && !line.navigation && !actions.test(line.text);

function entries(lines: Line[], ids: Map<string, string>, reader: Reader, message: AlertMessage) {
  const starts = new Map<string, number>();
  lines.forEach((line, index) => {
    for (const job of line.jobs) if (!starts.has(job)) starts.set(job, index);
  });
  const order = [...starts].sort((a, b) => a[1] - b[1]);

  const jobs: AlertEntry[] = [];
  let unreadable = 0;
  let previousEnd = -1;
  order.forEach(([url, start], n) => {
    const end = order[n + 1]?.[1] ?? lines.length;
    const card = lines.slice(start, end);
    const titles = (line: Line) => (line.linked.get(url) ?? []).filter((t) => !actions.test(t));
    const titleAt = card.findIndex((line) => titles(line).length > 0);
    const linkTexts = card.flatMap(titles);
    const linkText = linkTexts[0] ?? '';
    const before = lines
      .slice(previousEnd + 1, start)
      .filter(shown)
      .slice(-cardLines)
      .map((line) => line.text);
    // A link elsewhere ("See all jobs", "Unsubscribe") ends the card.
    const rest = card.slice(Math.max(titleAt, 0) + 1);
    const navigation = rest.findIndex((line) => line.navigation);
    const after = (navigation < 0 ? rest : rest.slice(0, navigation))
      .filter((line) => shown(line) && line.text !== linkText)
      .slice(0, cardLines)
      .map((line) => line.text);
    previousEnd = start + card.findLastIndex((line) => line.jobs.has(url));

    const read = (reader.card ?? defaultCard)({ linkText, linkTexts, before, after }, message);
    const title = read && clean(read.title);
    if (!read || !title || title.length > maxTitle) {
      unreadable += 1;
      return;
    }
    jobs.push({
      url,
      externalId: ids.get(url)!,
      title,
      company: read.company?.trim().slice(0, 1000) || null,
      location: read.location.trim().slice(0, 5000),
      details: read.details.trim().slice(0, maxDetails),
    });
  });
  return { jobs, unreadable };
}

/** Jobs read without a link: no address, an id made from company, title and location. */
function unlinkedEntries(lines: Line[], reader: Reader, message: AlertMessage): AlertEntry[] {
  if (!reader.unlinked) return [];
  return reader
    .unlinked(
      lines.filter(shown).map((line) => line.text),
      message,
    )
    .flatMap((card) => {
      const title = clean(card.title);
      const key = sameJobKey(card.company, title);
      if (!key || title.length > maxTitle) return [];
      const id = createHash('sha256').update(`${key}\u0000${locationKey(card.location)}`);
      return {
        url: null,
        externalId: `card-${id.digest('hex').slice(0, 40)}`,
        title,
        company: card.company!.trim().slice(0, 1000),
        location: card.location.trim().slice(0, 5000),
        details: card.details.trim().slice(0, maxDetails),
      };
    });
}

export function readJobs(message: AlertMessage, reader: Reader): ReadResult {
  const ids = new Map<string, string>();
  const html = message.html ? htmlLines(message.html, reader.jobLink, ids) : [];
  const fromHtml = entries(html, ids, reader, message);
  if (fromHtml.jobs.length) return fromHtml;
  const text = message.text ? textLines(message.text, reader.jobLink, ids) : [];
  const fromText = entries(text, ids, reader, message);
  if (fromText.jobs.length) return fromText;
  const unlinked = unlinkedEntries(html.length ? html : text, reader, message);
  return unlinked.length ? { jobs: unlinked, unreadable: 0 } : message.html ? fromHtml : fromText;
}
