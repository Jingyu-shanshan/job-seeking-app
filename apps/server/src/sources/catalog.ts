import type { CatalogEntry } from '@jsa/shared';
import { alertEntry, alertProviders } from '../alerts/providers.ts';

// Every site the app can take jobs from, and how. Each entry is one site and one access method,
// so there is no "search the whole web" entry. Add an entry the app requests only after checking
// the site's terms, and record the day and the page checked. A site whose terms forbid automated
// access, or that has no API an individual can use, gets an `email_alert` entry and never a
// requesting one; those live in alerts/providers.ts with what importing their emails needs, and
// record a terms check where one was made. Pasting and saving from the desktop app work for every
// site without an entry of its own.

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
    alert: null,
  },
  {
    id: 'ashby_board',
    name: 'Ashby job boards',
    access: 'board_api',
    note: 'Reads the public job list of a company job board hosted on Ashby. No login or key is needed. Add one board per company.',
    terms: {
      checkedOn: '2026-10-02',
      url: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    },
    // Ashby publishes no limit for these reads; this is the app's own.
    rateLimit: { requests: 1, perSeconds: 2 },
    param: {
      label: 'Board name',
      hint: 'The part after jobs.ashbyhq.com/ in the company’s job board address.',
      pattern: boardName,
    },
    alert: null,
  },
  ...alertProviders.map(alertEntry),
  {
    id: 'paste',
    name: 'Paste a job',
    access: 'manual',
    note: 'Paste a job’s link and text from any site, including sites with no API for job seekers such as 58.com. Always available, and nothing is requested from the site.',
    terms: null,
    rateLimit: null,
    param: null,
    alert: null,
  },
  {
    id: 'desktop_save',
    name: 'Save from the desktop app',
    access: 'manual',
    note: 'Browse any job site yourself in the desktop app’s built-in browser, signed in with your own account where the site needs one, and save the job page you are looking at, or the jobs a LinkedIn results page already shows. The app saves only when you click, and never opens, scrolls or clicks pages by itself.',
    terms: null,
    rateLimit: null,
    param: null,
    alert: null,
  },
];

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return catalog.find((entry) => entry.id === id);
}
