import type { CatalogEntry } from '@jsa/shared';

// Every site the app can take jobs from, and how. Each entry is one site and one access method,
// so there is no "search the whole web" entry. Add an entry only after checking the site's terms,
// and record the day and the page checked. A site whose terms forbid automated access, or that
// has no API an individual can use, gets an `email_alert` entry and never a requesting one; the
// note says why. Pasting works for every site without an entry of its own.

// Job board names: letters, digits, dots, hyphens and underscores, so a pasted URL is rejected.
const boardName = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';

export const catalog: readonly CatalogEntry[] = [
  {
    id: 'greenhouse_board',
    name: 'Greenhouse job boards',
    access: 'board_api',
    note: 'Reads the public job list of a company job board hosted on Greenhouse. No login or key is needed. Add one board per company.',
    terms: { checkedOn: '2026-10-01', url: 'https://docs.greenhouse.io/job-board.html' },
    // Greenhouse publishes no limit for these reads; this is the app's own.
    rateLimit: { requests: 1, perSeconds: 2 },
    param: {
      label: 'Board name',
      hint: 'The part after job-boards.greenhouse.io/ in the company’s job board address.',
      pattern: boardName,
    },
  },
  {
    id: 'ashby_board',
    name: 'Ashby job boards',
    access: 'board_api',
    note: 'Reads the public job list of a company job board hosted on Ashby. No login or key is needed. Add one board per company.',
    terms: {
      checkedOn: '2026-10-01',
      url: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    },
    // Ashby publishes no limit for these reads; this is the app's own.
    rateLimit: { requests: 1, perSeconds: 2 },
    param: {
      label: 'Board name',
      hint: 'The part after jobs.ashbyhq.com/ in the company’s job board address.',
      pattern: boardName,
    },
  },
  {
    id: 'linkedin_alert',
    name: 'LinkedIn job alerts',
    access: 'email_alert',
    note: 'LinkedIn’s User Agreement (section 8.2) forbids scraping or automating the site with software, scripts, bots or browser extensions, and LinkedIn has no job API for individuals. Set up job alerts on LinkedIn and import the alert emails. The app never visits LinkedIn with your account.',
    terms: { checkedOn: '2026-10-01', url: 'https://www.linkedin.com/legal/user-agreement' },
    rateLimit: null,
    param: null,
  },
  {
    id: 'duunitori_alert',
    name: 'Duunitori job alerts',
    access: 'email_alert',
    note: 'Duunitori’s robots.txt disallows all automated access, and no public terms for its API were found. Set up job alerts (hakuvahti) on Duunitori and import the alert emails.',
    terms: { checkedOn: '2026-10-01', url: 'https://duunitori.fi/robots.txt' },
    rateLimit: null,
    param: null,
  },
  {
    id: 'tyomarkkinatori_alert',
    name: 'Työmarkkinatori job alerts',
    access: 'email_alert',
    note: 'The official job search API is only for organisations with a Finnish business ID (Y-tunnus) that KEHA-keskus has approved. Set up job alerts on Työmarkkinatori and import the alert emails.',
    terms: {
      checkedOn: '2026-10-01',
      url: 'https://tyomarkkinatori.fi/ohjeet-ja-tuki/rajapinnat/tyopaikkailmoitusten-rajapinnat',
    },
    rateLimit: null,
    param: null,
  },
  {
    id: 'upwork_alert',
    name: 'Upwork job alerts',
    access: 'email_alert',
    note: 'Upwork ended its RSS feeds on 2024-08-20. Its official API needs a key that Upwork grants only to accounts meeting its eligibility rules, and its terms have not been reviewed for this app. Save a search on Upwork with email alerts on and import the alert emails.',
    terms: { checkedOn: '2026-10-01', url: 'https://www.upwork.com/developer' },
    rateLimit: null,
    param: null,
  },
  {
    id: 'paste',
    name: 'Paste a job',
    access: 'manual',
    note: 'Paste a job’s link and text from any site, including sites with no API for job seekers such as 58.com. Always available, and nothing is requested from the site.',
    terms: null,
    rateLimit: null,
    param: null,
  },
];

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return catalog.find((entry) => entry.id === id);
}
