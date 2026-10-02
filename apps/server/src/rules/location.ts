import type { LocationVerdict, SearchScope } from '@jsa/shared';

// Whether a job's location is in the user's search scope, from the location text the source gave.
// A job is only out of scope when every place it names is known to be outside the scope; a
// missing or unrecognised location is to be confirmed, never out (TASKS T13).
//
// "Helsinki" means Helsinki and Espoo, not Vantaa (user decision, 2026-10-01). A remote job counts,
// when the user includes remote jobs, only if it may be done from Finland: it names Finland, the
// EU, Europe, EMEA, the Nordics or the whole world. Remote from another named country only is out
// of scope, and a bare "Remote" is to be confirmed, because such jobs are often tied to the
// company's country (user decision, 2026-10-01). A location that names Helsinki or Espoo counts
// even when it also says remote or hybrid.

/** Where one of a job's locations is, as far as its text says. */
type Place =
  | 'helsinki'
  | 'finland'
  | 'elsewhere'
  | 'remote_from_finland'
  | 'remote_from_elsewhere'
  | 'remote_unclear'
  | 'unclear';

/** Matches any of `words` as whole words, ignoring case; letters may be non-ASCII. */
function anyWord(...words: string[]) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const helsinki = anyWord('helsinki', 'helsingfors', 'espoo', 'esbo');
const finland = anyWord('finland', 'suomi', 'vantaa', 'vanda');
const remote = anyWord('remote', 'etätyö', 'etä');
// Areas that include Finland, for remote jobs.
const includesFinland = anyWord(
  'eu',
  'eea',
  'europe',
  'emea',
  'nordics?',
  'worldwide',
  'global(?:ly)?',
  'anywhere',
);

// Names of places known to be outside Finland, lowercase: every country Node's ICU names, plus
// common other spellings and the US states (US jobs often give only "City, State").
const elsewhere = new Set<string>();
{
  const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  // Codes that are not a country outside Finland: Finland itself, the Åland Islands (part of
  // Finland), the EU and other groupings, and placeholders.
  const skip = new Set(['FI', 'AX', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of letters) {
    for (const b of letters) {
      const name = skip.has(a + b) ? undefined : regions.of(a + b);
      if (name) elsewhere.add(name.toLowerCase());
    }
  }
  const otherNames = `usa, us, u.s., u.s.a., united states of america, uk, u.k., great britain,
    england, scotland, wales, northern ireland, czech republic, turkey, the netherlands, holland,
    korea, hong kong, macau, uae, bosnia and herzegovina, myanmar,
    alabama, alaska, arizona, arkansas, california, colorado, connecticut, delaware, florida,
    georgia, hawaii, idaho, illinois, indiana, iowa, kansas, kentucky, louisiana, maine, maryland,
    massachusetts, michigan, minnesota, mississippi, missouri, montana, nebraska, nevada,
    new hampshire, new jersey, new mexico, new york, north carolina, north dakota, ohio, oklahoma,
    oregon, pennsylvania, rhode island, south carolina, south dakota, tennessee, texas, utah,
    vermont, virginia, washington, west virginia, wisconsin, wyoming, district of columbia`;
  for (const name of otherNames.split(/,\s*/)) elsewhere.add(name);
}

/**
 * True when a segment of the text ends with the name of a place outside Finland, e.g. "Germany"
 * in "Berlin, Germany", "United States" in "Central United States" or "US" in "Remote US".
 * Only whole trailing words count, so a name inside a longer one is not a match.
 */
function namesElsewhere(text: string) {
  return text
    .toLowerCase()
    .split(/[,;()/]|\s[-–—]\s/)
    .some((segment) => {
      const words = segment.trim().split(/\s+/);
      return words.some((_, i) => elsewhere.has(words.slice(i).join(' ')));
    });
}

function placeOf(text: string): Place {
  if (helsinki.test(text)) return 'helsinki';
  if (remote.test(text)) {
    if (finland.test(text) || includesFinland.test(text)) return 'remote_from_finland';
    return namesElsewhere(text) ? 'remote_from_elsewhere' : 'remote_unclear';
  }
  if (finland.test(text)) return 'finland';
  return namesElsewhere(text) ? 'elsewhere' : 'unclear';
}

const areaNames: Record<Exclude<SearchScope['area'], 'worldwide'>, string> = {
  helsinki: 'Helsinki or Espoo',
  finland: 'Finland',
};

/**
 * Classifies a job by its location text against the search scope. Several locations are
 * separated by ";" (Greenhouse's format); the job is in scope when any of them is. The reason
 * says why a job is out of scope or to be confirmed, and is '' for jobs in scope.
 */
export function classifyLocation(
  location: string,
  { area, includeRemote }: SearchScope,
): { verdict: LocationVerdict; reason: string } {
  if (area === 'worldwide') return { verdict: 'in_scope', reason: '' };
  const places = location
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(placeOf);
  if (places.length === 0) return { verdict: 'to_confirm', reason: 'No location given.' };

  const inScope = (place: Place) =>
    place === 'helsinki' ||
    (place === 'finland' && area === 'finland') ||
    (place === 'remote_from_finland' && includeRemote);
  if (places.some(inScope)) return { verdict: 'in_scope', reason: '' };

  if (places.includes('unclear')) {
    return { verdict: 'to_confirm', reason: 'The location is not one the app recognises.' };
  }
  if (includeRemote && places.includes('remote_unclear')) {
    return { verdict: 'to_confirm', reason: 'Remote, but it does not say from where.' };
  }

  const isRemote = places.some((place) => place.startsWith('remote_'));
  let reason = `Not in ${areaNames[area]}`;
  if (isRemote && !includeRemote) reason += '; remote jobs are not in the scope';
  else if (places.includes('remote_from_elsewhere')) reason += '; remote only from elsewhere';
  return { verdict: 'out_of_scope', reason: `${reason}.` };
}
