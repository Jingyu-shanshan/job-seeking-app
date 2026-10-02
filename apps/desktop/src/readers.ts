// Readers for the page the user is looking at. When the user clicks a save button, the main
// process sends one of these functions to the page as source text and runs it in an isolated
// world: it shares the page's DOM but none of its scripts, and the page cannot see or change it.
// The readers only read. They never click, scroll, type, load more or open anything, and they run
// once per click. So each must be self-contained: nothing from outside the function body.
//
// What they return is still the third-party page's content, untrusted: the main process checks
// its shape and size (saving.ts) before anything is sent to the app.
//
// LinkedIn: its pages have no stable markup contract. The class names below are the ones its job
// pages and job search results have used, for the signed-in and the signed-out layouts. A part the
// reader cannot find is reported as missing, never guessed (TASKS T21).

/** Sites with a reader of their own. Any other site gets the generic page reading. */
export type Site = 'linkedin';

export interface JobOnPage {
  title: string;
  company: string;
  location: string;
  /** The job's description as shown, without the rest of the page. */
  text: string;
}

export interface PageReading {
  /** The page's title, as the browser tab shows it. */
  title: string;
  /** The text the user selected on the page; '' when nothing is selected. */
  selection: string;
  /** The page's visible text; '' on a site with a reader, which saves the job's part only. */
  text: string;
  /** The page's JSON-LD blocks, where many job sites describe the job as a schema.org JobPosting. */
  jsonLd: string[];
  /** The job a site reader found on the page; null without a reader, or when it found none. */
  job: JobOnPage | null;
}

/** Reads the job page the user is looking at. */
export function readJobPage(site: Site | null): PageReading {
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const shown = (el: Element) =>
    typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true });
  // The first of `selectors` that is shown and has text.
  const first = (selectors: string[], keepLines = false) => {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (!shown(el)) continue;
        const text = keepLines ? (el.innerText ?? '').trim() : clean(el.innerText);
        if (text) return text;
      }
    }
    return '';
  };

  const reading: PageReading = {
    title: clean(document.title),
    selection: (window.getSelection()?.toString() ?? '').trim(),
    text: '',
    jsonLd: [],
    job: null,
  };

  if (site === 'linkedin') {
    const text = first(
      [
        '#job-details',
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.show-more-less-html__markup',
        '.description__text',
      ],
      true,
    );
    if (text) {
      // "Helsinki, Uusimaa, Finland · 2 weeks ago · Over 100 applicants": the place comes first.
      const place = clean(
        first([
          '.job-details-jobs-unified-top-card__tertiary-description-container',
          '.job-details-jobs-unified-top-card__primary-description-container',
          '.job-details-jobs-unified-top-card__bullet',
          '.jobs-unified-top-card__bullet',
          '.topcard__flavor--bullet',
        ]).split('·')[0],
      );
      const workplace = /\b(Remote|Hybrid|On-site)\b/i.exec(
        first([
          '.job-details-fit-level-preferences',
          '.job-details-preferences-and-skills',
          '.jobs-unified-top-card__workplace-type',
        ]),
      )?.[1];
      reading.job = {
        title: first([
          '.job-details-jobs-unified-top-card__job-title',
          '.jobs-unified-top-card__job-title',
          '.top-card-layout__title',
          '.topcard__title',
        ]),
        company: first([
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
          '.top-card-layout__second-subline .topcard__flavor',
        ]),
        location:
          place && workplace && !place.includes(workplace) ? `${place} (${workplace})` : place,
        text,
      };
    }
    return reading;
  }

  reading.text = (document.body?.innerText ?? '').trim();
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (reading.jsonLd.length < 20)
      reading.jsonLd.push((script.textContent ?? '').slice(0, 200_000));
  }
  return reading;
}

export interface ResultEntry {
  /** LinkedIn's id of the job. */
  id: string;
  title: string;
  company: string;
  location: string;
}

export interface ResultsReading {
  entries: ResultEntry[];
  /**
   * Job entries on the page the reader could not read: ones LinkedIn has not filled in yet
   * because they were never scrolled into view, or ones laid out in a way it does not know.
   */
  unreadable: number;
}

/** Reads the job entries a LinkedIn search or collection page shows now. */
export function readLinkedInResults(): ResultsReading {
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const shown = (el: Element) =>
    typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true });
  const within = (card: Element, selectors: string[]) => {
    for (const selector of selectors) {
      for (const el of card.querySelectorAll<HTMLElement>(selector)) {
        const text = shown(el) ? clean(el.innerText) : '';
        if (text) return text;
      }
    }
    return '';
  };
  const idOf = (el: Element) => {
    const id =
      el.getAttribute('data-occludable-job-id') ??
      el.getAttribute('data-job-id') ??
      /^urn:li:jobPosting:(\d+)$/.exec(el.getAttribute('data-entity-urn') ?? '')?.[1];
    return id && /^\d{1,20}$/.test(id) ? id : null;
  };

  // A card and the card inside it carry the same id; the outermost comes first.
  const cards = new Map<string, Element>();
  for (const el of document.querySelectorAll(
    '[data-occludable-job-id], .job-card-container[data-job-id], [data-entity-urn^="urn:li:jobPosting:"]',
  )) {
    const id = idOf(el);
    if (id && !cards.has(id) && shown(el)) cards.set(id, el);
  }

  const reading: ResultsReading = { entries: [], unreadable: 0 };
  for (const [id, card] of cards) {
    const title = within(card, [
      '.job-card-list__title--link strong',
      '.job-card-list__title--link [aria-hidden="true"]',
      '.artdeco-entity-lockup__title strong',
      '.artdeco-entity-lockup__title [aria-hidden="true"]',
      '.job-card-list__title',
      '.base-search-card__title',
    ]);
    const company = within(card, [
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.job-card-container__company-name',
      '.base-search-card__subtitle',
    ]);
    const location = within(card, [
      '.job-card-container__metadata-wrapper li',
      '.job-card-container__metadata-item',
      '.artdeco-entity-lockup__caption',
      '.job-search-card__location',
    ]);
    if (title && company) reading.entries.push({ id, title, company, location });
    else reading.unreadable += 1;
  }
  return reading;
}
