import { lookup } from 'node:dns';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Parser } from 'htmlparser2';
import { decodeHTML } from 'entities';
import { jobLinkImportProblem } from '@jsa/shared/job-link-import';
import { checkJobText, DiscoveryError, type JobText } from '../discovery/adapter.ts';
import { htmlToText } from '../discovery/html.ts';
import { httpError } from '../http-error.ts';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

const manual = 'Open the job in the desktop app and choose Save this job, or paste its text.';

export function pageUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw httpError(400, 'Enter a valid https job link.');
  }
  const problem = jobLinkImportProblem(address);
  if (problem) throw httpError(400, problem);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    !url.hostname.includes('.')
  ) {
    throw httpError(
      400,
      'Use a public https company job link without credentials or a custom port.',
    );
  }
  url.hash = '';
  return url;
}

/** Pin the connection to the DNS answer we checked, including on every redirect. */
export async function readCompanyPage(address: string, redirects = 0): Promise<JobText> {
  const url = pageUrl(address);
  const result = await new Promise<{ html: string; redirect?: string }>((resolve, reject) => {
    const request = get(
      url,
      {
        agent: false,
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: 'text/html',
          'user-agent': 'JobSeekingApp/1.0 (user-requested job import)',
        },
        lookup(hostname, options, callback) {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, []);
            if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
              return callback(new Error('The address does not resolve to a public website.'), []);
            }
            // Node requests all addresses when autoSelectFamily is enabled.
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          });
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy();
          resolve({ html: '', redirect: response.headers.location });
          return;
        }
        if (status !== 200 || !response.headers['content-type']?.includes('text/html')) {
          response.destroy();
          reject(
            new DiscoveryError(
              `The website did not return a public job page (HTTP ${status}). ${manual}`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            request.destroy(new DiscoveryError(`The job page exceeds 2 MB. ${manual}`));
          } else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    request.on('error', (error) =>
      reject(
        error instanceof DiscoveryError
          ? error
          : new DiscoveryError(`Could not read the public job page. ${manual}`, { cause: error }),
      ),
    );
  });
  if (result.redirect) {
    if (redirects >= 3)
      throw new DiscoveryError(`The job link redirects too many times. ${manual}`);
    return readCompanyPage(new URL(result.redirect, url).href, redirects + 1);
  }
  return companyJob(result.html, url.href);
}

/** Prefer a single JobPosting; a list of vacancies must never become one job. */
export function companyJob(html: string, url: string): JobText {
  const postings: Record<string, unknown>[] = [];
  let script = '';
  let inJson = false;
  let heading = '';
  let inHeading = false;
  let main = '';
  let mainDepth = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
    if (types.includes('JobPosting')) postings.push(item);
    if (item['@graph']) visit(item['@graph']);
    if (item['mainEntity']) visit(item['mainEntity']);
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'script' && attrs.type?.toLowerCase() === 'application/ld+json') {
        inJson = true;
        script = '';
      }
      if (name === 'h1') inHeading = true;
      if (mainDepth || name === 'main' || name === 'article') {
        mainDepth += 1;
        main += `<${name}>`;
      }
    },
    ontext(text) {
      if (inJson) script += text;
      if (inHeading) heading += text;
      if (mainDepth) main += text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    },
    onclosetag(name) {
      if (name === 'script' && inJson) {
        inJson = false;
        try {
          visit(JSON.parse(script));
        } catch {
          /* Invalid metadata can use readable HTML. */
        }
      }
      if (name === 'h1') inHeading = false;
      if (mainDepth) {
        main += `</${name}>`;
        mainDepth -= 1;
      }
    },
  });
  parser.end(html);
  if (postings.length > 1) throw new DiscoveryError(`Use a single job detail link. ${manual}`);
  const posting = postings[0];
  const string = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const title = string(posting?.title) || heading.trim();
  const description = string(posting?.description);
  const text = htmlToText(description ? decodeHTML(description) : main);
  // shortcut: static HTML only; add browser rendering when real company pages require it.
  if (
    !title ||
    title.length > 1000 ||
    text.length < 100 ||
    (!posting &&
      !/responsibilit|qualifications?|requirements?|apply|työtehtäv|vaatimuk|职责|要求/i.test(text))
  ) {
    throw new DiscoveryError(`No complete single-job description was found. ${manual}`);
  }
  const organization = posting?.hiringOrganization as Record<string, unknown> | undefined;
  const places = [posting?.jobLocation].flat().filter(Boolean) as Record<string, unknown>[];
  const location = places
    .map((place) => {
      const address = place.address as Record<string, unknown> | undefined;
      return address
        ? ['addressLocality', 'addressRegion', 'addressCountry']
            .map((key) => string(address[key]))
            .filter(Boolean)
            .join(', ')
        : '';
    })
    .filter(Boolean)
    .join('; ')
    .slice(0, 5000);
  return {
    title,
    company: string(organization?.name).slice(0, 1000) || null,
    location,
    url,
    text: checkJobText(text, 'The company website'),
  };
}
