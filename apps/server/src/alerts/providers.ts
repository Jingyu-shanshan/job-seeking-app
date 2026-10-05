import type { AlertKind, AlertSection, CatalogEntry } from '@jsa/shared';
import { type SenderRule, shownSender } from '../rules/alert-email.ts';
import { jobPageAddress } from '../rules/job-page.ts';
import { type CardRule, type JobLink, type Reader, companyAndLocation } from './read.ts';

// The job-alert sources (T20): sites whose job-alert emails the user imports, because the app does
// not request the site itself. Each is a catalog entry of access `email_alert` plus what the
// import needs: who sends its alerts and which of their emails are alerts (rules/alert-email.ts),
// how a link to one of its jobs looks, and how its job cards read. Adding a source means adding
// an entry here; the import pipeline stays the same.
//
// The senders come from the user's own mailbox (2026-10-03), and the link and card rules from
// real job emails of LinkedIn, Upwork, Duunitori, The Hub, Jooble, Totaljobs, Wärtsilä,
// Teamtailor and Työmarkkinatori, plus a Glassdoor recently-viewed reminder (2026-10-05).
// Two real Snaphunt new-job emails only have opaque SendGrid links and cannot be read locally.
// Glassdoor saved-search alerts and recruiter job invitations remain unverified; their link
// rules, like Snaphunt’s, only read links that look like job pages.
// Sites seen only in passing there (Indeed, Oikotie, Jobly, Academic Work, Barona) have no entry.

export interface AlertProvider extends Reader {
  id: string;
  name: string;
  note: string;
  terms: CatalogEntry['terms'];
  kind: AlertKind;
  section: AlertSection;
  senders: readonly SenderRule[];
}

// Subjects of mail that is never a job alert, whoever sends it. Kept narrow, because job titles
// say "Security", "Applications" or "Applied" too.
const accountMail =
  /\b(?:password|passcode|verify your|confirm your|sign[- ]in|log[- ]in|welcome to|unsubscribe|salasana|vahvista|kirjaudu)\b/i;
const applicationMail =
  /\byour application\b|\bapplication (?:received|sent|submitted|status|update)|\bthanks? (?:you )?for (?:applying|your application)|\byou applied\b|\bsent to\b|\bwas viewed\b|\binterview\b|\bhakemuksesi\b|\bhaastattel/i;

function hostIs(url: URL, ...hosts: string[]) {
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host === `www.${h}`);
}

/** A query parameter, whatever the case of its name. */
function param(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name) return value;
  return null;
}

const linkedInJob: JobLink = (url) => {
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return undefined;
  const address = jobPageAddress(`https://${host}${url.pathname}${url.search}`);
  if ('error' in address) return undefined;
  return { url: address.url, id: /\/(\d+)\/$/.exec(address.url)![1]! };
};

/** A job at `https://<host><path>` with the id from `pattern`'s first group, query dropped. */
function pathJob(hosts: string[], pattern: RegExp, canonical?: (id: string) => string): JobLink {
  return (url) => {
    if (!hostIs(url, ...hosts)) return undefined;
    const match = pattern.exec(url.pathname);
    if (!match?.[1]) return undefined;
    const id = match[1];
    return {
      url: canonical ? canonical(id) : `https://${url.hostname.toLowerCase()}${match[0]}`,
      id,
    };
  };
}

// Teamtailor career sites run on the company's own host, at /jobs/<id>-<title>.
const teamtailorJob: JobLink = (url) => {
  const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/(\d{3,15})(?:-[^/]*)?\/?$/i.exec(
    url.pathname,
  );
  if (!match?.[1]) return undefined;
  return { url: `https://${url.hostname.toLowerCase()}/jobs/${match[1]}`, id: match[1] };
};

// Country codes written as names, so that "Vancouver, CA" reads as Canada and not California.
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

function withCountry(location: string) {
  return location.replace(/,\s*([A-Z]{2})$/, (whole, code: string) => {
    const name = regions.of(code);
    return name && name !== code ? `, ${name}` : whole;
  });
}

/** The lines after the last one that reads `line`, e.g. a title written above its link. */
function linesAfter(lines: string[], line: string) {
  const at = lines.lastIndexOf(line);
  return at < 0 ? [] : lines.slice(at + 1);
}

/** "Hybrid Remote" and the like, as a note after the location. */
function withWorkplace(location: string, note: string) {
  const kinds = note.match(/\b(?:remote|hybrid|on-?site)\b/gi);
  return kinds ? `${location} (${kinds.join(', ')})`.trim() : location;
}

// Teamtailor talent-community alerts. The subject names the company: "Capalo AI: 2 new jobs
// matching your profile", or in the older single-job layout "Aimo : Software Developer". Newer
// cards link the title and follow it with "Department · Locations · Hybrid" or a location;
// older ones put the title, "Department - Locations" and "Hybrid Remote" above a "View ad" link.
const teamtailorCard: CardRule = ({ linkText, before, after }, message) => {
  const [, company = null, subjectTitle = ''] =
    /^(.{1,200}?)\s*:\s+(.+)$/.exec(message.subject) ?? [];
  if (linkText) {
    const line = /^since you have connected\b/i.test(after[0] ?? '') ? '' : (after[0] ?? '');
    const parts = line.split(/\s+·\s+/);
    if (parts.length === 3) {
      const [department, locations, workplace] = parts as [string, string, string];
      return {
        title: linkText,
        company,
        location: withWorkplace(locations, workplace),
        details: department,
      };
    }
    return { title: linkText, company, location: line, details: '' };
  }
  if (!subjectTitle || /\bnew jobs? matching\b/i.test(subjectTitle)) return null;
  const [place = '', workplace = ''] = linesAfter(before, subjectTitle);
  const dash = place.indexOf(' - ');
  return {
    title: subjectTitle,
    company,
    location: withWorkplace(dash < 0 ? place : place.slice(dash + 3), workplace),
    details: dash < 0 ? '' : place.slice(0, dash),
  };
};

export const alertProviders: readonly AlertProvider[] = [
  {
    id: 'linkedin_alert',
    name: 'LinkedIn',
    kind: 'job_alert',
    section: 'platforms',
    note: 'LinkedIn’s User Agreement (section 8.2) forbids scraping or automating the site with software, scripts, bots or browser extensions, and LinkedIn has no job API for individuals. Import LinkedIn’s job alerts, job recommendations and hiring notices. The app never visits LinkedIn by itself; you can browse it yourself in the desktop app and save the page you are looking at.',
    terms: { checkedOn: '2026-10-01', url: 'https://www.linkedin.com/legal/user-agreement' },
    senders: [
      { from: 'jobalerts-noreply@linkedin.com', alertsOnly: true },
      // Recommendations, but also application updates.
      { from: 'jobs-noreply@linkedin.com', notSubjects: [applicationMail], alertsOnly: false },
      { from: 'jobs-listings@linkedin.com', alertsOnly: true },
      // Mostly messages and social notifications; only openings count.
      {
        from: 'messages-noreply@linkedin.com',
        subjects: [/\bopenings?\b/i, /\b(?:is|are) hiring\b/i, /\bjobs?\b/i, /\bvacanc/i],
        notSubjects: [applicationMail],
        alertsOnly: false,
      },
    ],
    // The title links to the job, then "Company · Location (Hybrid)".
    jobLink: linkedInJob,
  },
  {
    id: 'duunitori_alert',
    name: 'Duunitori',
    kind: 'job_alert',
    section: 'platforms',
    note: 'Duunitori’s robots.txt disallows all automated access, and no public terms for its API were found. Set up job alerts (Duunivahti) on Duunitori and import the alert emails.',
    terms: { checkedOn: '2026-10-01', url: 'https://duunitori.fi/robots.txt' },
    senders: [{ from: 'duunivahti@duunitori.fi', alertsOnly: true }],
    jobLink: pathJob(['duunitori.fi'], /^\/tyopaikat\/tyo\/[a-z0-9-]*?-?(\d{5,12})\/?$/i),
    // Company, title and an excerpt above a "Read more" link; no location.
    card: ({ before }) => {
      if (before.length < 3) return null;
      const [company, title, excerpt] = before.slice(-3) as [string, string, string];
      return { title, company, location: '', details: excerpt };
    },
  },
  {
    id: 'thehub_alert',
    name: 'The Hub',
    kind: 'job_recommendation',
    section: 'platforms',
    note: 'The Hub’s terms (section 7) forbid copying or reusing its content without written consent, and it has no API for job seekers. Import the job recommendations and alerts it emails you.',
    terms: { checkedOn: '2026-10-03', url: 'https://thehub.io/terms' },
    senders: [
      { from: 'noreply@thehub.io', notSubjects: [accountMail, applicationMail], alertsOnly: false },
    ],
    // The title links to the job, then company, location and job type, each on its own.
    jobLink: pathJob(
      ['thehub.io'],
      /^\/jobs\/([0-9a-f]{24})\/?$/i,
      (id) => `https://thehub.io/jobs/${id}`,
    ),
  },
  {
    id: 'jooble_alert',
    name: 'Jooble',
    kind: 'job_alert',
    section: 'platforms',
    note: 'Jooble’s API is for owners of websites who show its jobs on their own site, not for job seekers. Import its job alerts when they link individual jobs. Emails linking only a saved search have no readable job and are marked Needs review; the app never opens the search.',
    terms: { checkedOn: '2026-10-03', url: 'https://jooble.org/api/about' },
    senders: [{ from: 'subscribe@fi.jooble.org', alertsOnly: true }],
    // Browser check (2026-10-05): /alert-vacancy/<code>/0 is a saved search, not a job.
    // Individual results link to /desc/<signed numeric id>. Never import a search as a job.
    jobLink: pathJob(['fi.jooble.org'], /^\/desc\/(-?\d{1,20})\/?$/),
  },
  {
    id: 'glassdoor_alert',
    name: 'Glassdoor',
    kind: 'job_alert',
    section: 'platforms',
    note: 'Import the job alerts and job reminders Glassdoor emails you. Mail from info@glassdoor.com (community posts, articles, reviews and salaries) and its weekly company updates are not imported. The app never requests Glassdoor.',
    terms: null,
    senders: [
      {
        from: 'noreply@glassdoor.com',
        // Company updates: "Just in at Acme: This week's employee reviews and more".
        notSubjects: [accountMail, applicationMail, /\bemployee reviews\b|\breviews and more\b/i],
        alertsOnly: false,
      },
    ],
    jobLink: (url) => {
      const host = url.hostname.toLowerCase();
      if (!/^(?:www\.)?glassdoor\.[a-z.]{2,6}$/.test(host)) return undefined;
      const id = param(url, 'jl') ?? param(url, 'joblistingid');
      if (!id || !/^\d{5,20}$/.test(id)) return undefined;
      return { url: `https://www.glassdoor.com/job-listing/index.htm?jl=${id}`, id };
    },
    // Recently-viewed job reminders link the title and "Company - Location" separately.
    // Only that line belongs to the card; the recipient and settings below the last job do not.
    card: ({ linkText, after }) => {
      const line = after[0] ?? '';
      const dash = line.lastIndexOf(' - ');
      if (!linkText || dash <= 0 || !line.slice(dash + 3).trim()) return null;
      return {
        title: linkText,
        company: line.slice(0, dash).trim(),
        location: line.slice(dash + 3).trim(),
        details: '',
      };
    },
  },
  {
    id: 'totaljobs_alert',
    name: 'Totaljobs',
    kind: 'job_alert',
    section: 'platforms',
    note: 'Import the job alerts and recommendations Totaljobs emails you; its alerts also list jobs on its sister site CWJobs. The app never requests Totaljobs.',
    terms: null,
    senders: [
      {
        from: 'totaljobs@totaljobsmail.com',
        subjects: [/\bjobs?\b/i],
        notSubjects: [accountMail, applicationMail],
        alertsOnly: true,
      },
      // One recommended job: "Our recommendation: Full Stack Engineer".
      {
        from: 'totaljobs@jobs.totaljobsmail.com',
        subjects: [/^Our recommendation:/i],
        alertsOnly: true,
      },
    ],
    // Links go to /JobSearch/EmailLink.aspx?JobID=<id>, directly or inside a click tracker.
    jobLink: (url) => {
      const site = ['totaljobs.com', 'cwjobs.co.uk'].find((host) => hostIs(url, host));
      if (!site || !/^\/jobsearch\/emaillink\.aspx$/i.test(url.pathname)) return undefined;
      const id = param(url, 'jobid');
      return id && /^\d{5,15}$/.test(id) ? { url: `https://www.${site}/job/${id}`, id } : undefined;
    },
    // Alerts link the title and follow it with company, location and pay. A recommendation
    // writes its title above "Company · Location · Contract · Pay" and links "Send application".
    card: ({ linkText, before, after }, message) => {
      if (linkText) return { title: linkText, ...companyAndLocation(after) };
      const title = /^Our recommendation:\s*(.+)$/i.exec(message.subject)?.[1]?.trim();
      return title ? { title, ...companyAndLocation(linesAfter(before, title)) } : null;
    },
  },
  {
    id: 'snaphunt_alert',
    name: 'Snaphunt',
    kind: 'job_recommendation',
    section: 'platforms',
    note: 'Import the job matches Snaphunt emails you (“Matching job: … at …”). Its other mail is career marketing and application updates, so an email counts only when a job can be read from it. Snaphunt links its jobs only through an email tracker the app does not open, so these jobs have no link: open the email’s “View job” yourself to get to the job. The app never requests Snaphunt.',
    terms: null,
    senders: [
      {
        from: 'no-reply@notifications.snaphunt.com',
        notSubjects: [accountMail, applicationMail],
        alertsOnly: false,
      },
    ],
    jobLink: pathJob(['snaphunt.com'], /^\/jobs?\/([A-Za-z0-9_-]{4,64})\/?$/),
    // Every link goes through SendGrid's encrypted tracker (user decision 2026-10-05: import the
    // job without a link). One job per email, named in the subject ("Matching job: Odoo
    // Consultant at Example") and followed in the email by the company, "REMOTE | Europe/Berlin"
    // and a line of perks. A title can say " at " too, so the split is where the lines agree.
    unlinked: (lines, message) => {
      const named = /^Matching job:\s*(.+)$/i.exec(message.subject)?.[1]?.trim() ?? '';
      for (let at = named.lastIndexOf(' at '); at > 0; at = named.lastIndexOf(' at ', at - 1)) {
        const title = named.slice(0, at).trim();
        const company = named.slice(at + 4).trim();
        const [shown, place = '', perks = ''] = linesAfter(lines, title);
        if (shown !== company) continue;
        const details = /^what does this mean\b/i.test(perks) ? '' : perks;
        return [{ title, company, location: place, details }];
      }
      return [];
    },
  },
  {
    id: 'upwork_alert',
    name: 'Upwork',
    kind: 'freelance_alert',
    section: 'freelance',
    note: 'Upwork ended its RSS feeds on 2024-08-20. Its official API needs a key that Upwork grants only to accounts meeting its eligibility rules, and its terms have not been reviewed for this app. Save a search on Upwork with email alerts on and import the alert emails. Upwork names no client, so its jobs have no company.',
    terms: { checkedOn: '2026-10-01', url: 'https://www.upwork.com/developer' },
    senders: [{ from: 'donotreply@upwork.com', subjects: [/^New job alert:/i], alertsOnly: true }],
    jobLink: pathJob(
      ['upwork.com'],
      /^\/(?:jobs|freelance-jobs\/apply)\/(?:[^/?#]*_)?(~0[0-9a-z]{17,30})\/?$/i,
      (id) => `https://www.upwork.com/jobs/${id}`,
    ),
    // The title links to the job, then the pay, terms and the start of the description.
    card: ({ linkText, after }) =>
      linkText
        ? { title: linkText, company: null, location: '', details: after.join(' · ') }
        : null,
  },
  {
    id: 'wartsila_careers_alert',
    name: 'Wärtsilä Careers',
    kind: 'company_career_alert',
    section: 'company',
    note: 'Job alerts from Wärtsilä’s careers site (careers.wartsila.com), which runs on SAP SuccessFactors. The app never requests the careers site.',
    terms: null,
    senders: [{ from: 'wrtsiloyj-jobnotification@noreply12.jobs2web.com', alertsOnly: true }],
    jobLink: pathJob(['careers.wartsila.com'], /^\/job\/[^/?#]+\/(\d{4,15})\/?$/),
    // A list of links such as "Agile Coach - Vaasa, FI".
    card: ({ linkText }) => {
      if (!linkText) return null;
      const match = /^(.*\S)\s+-\s+([^-]+,\s*[A-Z]{2})$/.exec(linkText);
      return match
        ? { title: match[1]!, company: 'Wärtsilä', location: withCountry(match[2]!), details: '' }
        : { title: linkText, company: 'Wärtsilä', location: '', details: '' };
    },
  },
  {
    id: 'teamtailor_alert',
    name: 'Teamtailor companies',
    kind: 'company_career_alert',
    section: 'company',
    note: 'Job alerts from companies whose career sites run on Teamtailor, sent when you join a company’s talent community. Only emails with new job matches are imported, not application updates or community notices. The app never requests the career sites.',
    terms: null,
    senders: [
      {
        from: /^no-reply@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.teamtailor-mail\.com$/,
        shown: 'no-reply@<company>.teamtailor-mail.com',
        subjects: [/\bnew jobs? matching your profile\b/i],
        alertsOnly: true,
      },
      // The older address, one job per email: "Aimo : Software Developer".
      {
        from: 'no-reply@message.teamtailor.com',
        notSubjects: [accountMail, applicationMail],
        alertsOnly: false,
      },
    ],
    jobLink: teamtailorJob,
    card: teamtailorCard,
  },
  {
    id: 'tyomarkkinatori_alert',
    name: 'Työmarkkinatori',
    kind: 'job_alert',
    section: 'government',
    note: 'The official job search API is only for organisations with a Finnish business ID (Y-tunnus) that KEHA-keskus has approved. Set up job alerts on Työmarkkinatori and import the alert emails. Its other mail (account, profile and subscription messages) is not imported, and an email counts only when jobs can be read from it.',
    terms: {
      checkedOn: '2026-10-01',
      url: 'https://tyomarkkinatori.fi/ohjeet-ja-tuki/rajapinnat/tyopaikkailmoitusten-rajapinnat',
    },
    senders: [
      {
        from: 'noreply@tyomarkkinatori.fi',
        notSubjects: [accountMail, /\bprofiili|\bprofile\b|vanhentu|subscription confirmation/i],
        alertsOnly: false,
      },
    ],
    jobLink: pathJob(
      ['tyomarkkinatori.fi'],
      /^\/(?:[a-z]{2}\/)?(?:henkiloasiakkaat|personal-customers)\/(?:avoimet-tyopaikat|vacancies)\/([0-9a-f-]{36})(?:\/[^/]*)?\/?$/i,
      (id) => `https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/${id}`,
    ),
    // A linked title, then "Company - Location", then an optional application deadline.
    // The last card is followed by subscription instructions, which are not job details.
    card: ({ linkText, after }) => {
      const [line = '', deadline = ''] = after;
      const dash = line.lastIndexOf(' - ');
      if (!linkText || dash <= 0 || !line.slice(dash + 3).trim()) return null;
      return {
        title: linkText,
        company: line.slice(0, dash).trim(),
        location: line.slice(dash + 3).trim(),
        details: /^Application period ends\b/i.test(deadline) ? deadline : '',
      };
    },
  },
  {
    id: 'teamtailor_recruiter',
    name: 'Recruiter opportunities',
    kind: 'recruiter_opportunity',
    section: 'optional',
    note: 'Messages from companies’ recruiters through Teamtailor. The same address also sends application receipts, hand-overs and rejections, with the same kind of subject (“Senior Backend Developer at Example Club”), so a message counts only when it links to a job, and replies and interview arrangements never do. They are not saved-search alerts, so they are off until you turn them on.',
    terms: null,
    senders: [
      {
        from: 'conversations@message.teamtailor.com',
        notSubjects: [/^(?:re|fw|fwd|vs|sv):/i, applicationMail, accountMail],
        alertsOnly: false,
      },
    ],
    jobLink: teamtailorJob,
    // "Senior Backend Developer at Example Club": the company is in the subject.
    card: ({ linkText, after }, message) =>
      linkText
        ? {
            title: linkText,
            company: /\bat (.{1,200})$/i.exec(message.subject)?.[1]?.trim() ?? null,
            location: after[0] ?? '',
            details: after.slice(1).join(' · '),
          }
        : null,
  },
];

/** The provider's catalog entry, as the Sources page shows it. */
export function alertEntry(provider: AlertProvider): CatalogEntry {
  return {
    id: provider.id,
    name: provider.name,
    access: 'email_alert',
    note: provider.note,
    terms: provider.terms,
    rateLimit: null,
    param: null,
    alert: {
      kind: provider.kind,
      section: provider.section,
      senders: provider.senders.map(shownSender),
      // A recruiter's message is not a saved search the user set up.
      onByDefault: provider.kind !== 'recruiter_opportunity',
    },
  };
}

export function findAlertProvider(id: string): AlertProvider | undefined {
  return alertProviders.find((provider) => provider.id === id);
}
