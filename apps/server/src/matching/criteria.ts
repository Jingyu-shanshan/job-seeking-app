import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CriteriaSchema, type Criteria } from '@jsa/shared';
import type { Pool } from 'pg';
import { httpError } from '../http-error.ts';
import { languageOf } from '../rules/criteria.ts';

// The user's criteria (T06): one row, job_criteria, that also holds the search scope. They are
// applied when jobs are read, so saving them changes the job list at once and requests nothing.

interface CriteriaRow {
  area: Criteria['location']['area'];
  include_remote: boolean;
  location_strength: Criteria['location']['strength'];
  location_if_unknown: Criteria['location']['ifUnknown'];
  title_strength: Criteria['title']['strength'];
  title_words: string[];
  avoid_strength: Criteria['avoidInTitle']['strength'];
  avoid_words: string[];
  language_strength: Criteria['languages']['strength'];
  language_if_unknown: Criteria['languages']['ifUnknown'];
  languages: string[];
  employment_strength: Criteria['employmentType']['strength'];
  employment_if_unknown: Criteria['employmentType']['ifUnknown'];
  employment_types: Criteria['employmentType']['types'];
  must_have_strength: Criteria['mustHaves']['strength'];
  must_have_if_unknown: Criteria['mustHaves']['ifUnknown'];
}

export async function loadCriteria(pool: Pool): Promise<Criteria> {
  const { rows } = await pool.query<CriteriaRow>('select * from job_criteria');
  const row = rows[0];
  // The migrations insert the only row; nothing deletes it.
  if (!row) throw new Error('job_criteria has no row');
  return {
    location: {
      strength: row.location_strength,
      ifUnknown: row.location_if_unknown,
      area: row.area,
      includeRemote: row.include_remote,
    },
    title: { strength: row.title_strength, words: row.title_words },
    avoidInTitle: { strength: row.avoid_strength, words: row.avoid_words },
    languages: {
      strength: row.language_strength,
      ifUnknown: row.language_if_unknown,
      languages: row.languages,
    },
    employmentType: {
      strength: row.employment_strength,
      ifUnknown: row.employment_if_unknown,
      types: row.employment_types,
    },
    mustHaves: { strength: row.must_have_strength, ifUnknown: row.must_have_if_unknown },
  };
}

/** Each entry once, ignoring case and spacing, without the ones that are only space. */
function distinct(entries: readonly string[], key = (entry: string) => entry.toLowerCase()) {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const tidy = entry.trim().replace(/\s+/g, ' ');
    if (tidy !== '' && !seen.has(key(tidy))) seen.set(key(tidy), tidy);
  }
  return [...seen.values()];
}

/** The criteria as they are saved, or a 400 that says what to change. */
export function tidyCriteria(criteria: Criteria): Criteria {
  const unknownLanguage = criteria.languages.languages.find((name) => !languageOf(name));
  if (unknownLanguage) {
    throw httpError(400, `“${unknownLanguage.trim()}” is not a language the app recognises.`);
  }
  const tidy: Criteria = {
    ...criteria,
    title: { ...criteria.title, words: distinct(criteria.title.words) },
    avoidInTitle: { ...criteria.avoidInTitle, words: distinct(criteria.avoidInTitle.words) },
    languages: {
      ...criteria.languages,
      languages: distinct(criteria.languages.languages, (name) => languageOf(name)!),
    },
    employmentType: {
      ...criteria.employmentType,
      types: [...new Set(criteria.employmentType.types)],
    },
  };
  const empty: [boolean, string][] = [
    [tidy.title.strength !== 'off' && tidy.title.words.length === 0, 'words for the job title'],
    [
      tidy.avoidInTitle.strength !== 'off' && tidy.avoidInTitle.words.length === 0,
      'words to avoid in the title',
    ],
    [
      tidy.languages.strength !== 'off' && tidy.languages.languages.length === 0,
      'a language you can work in',
    ],
    [
      tidy.employmentType.strength !== 'off' && tidy.employmentType.types.length === 0,
      'an employment type you accept',
    ],
  ];
  const missing = empty.find(([isEmpty]) => isEmpty);
  if (missing) throw httpError(400, `Add ${missing[1]}, or turn that criterion off.`);
  return tidy;
}

export interface CriteriaRoutesOptions {
  pool: Pool;
}

export const criteriaRoutes: FastifyPluginAsyncTypebox<CriteriaRoutesOptions> = async (
  app,
  { pool },
) => {
  app.get('/criteria', { schema: { response: { 200: CriteriaSchema } } }, () => loadCriteria(pool));

  app.put(
    '/criteria',
    { schema: { body: CriteriaSchema, response: { 200: CriteriaSchema } } },
    async (request) => {
      const c = tidyCriteria(request.body);
      await pool.query(
        `update job_criteria set
           area = $1, include_remote = $2, location_strength = $3, location_if_unknown = $4,
           title_strength = $5, title_words = $6, avoid_strength = $7, avoid_words = $8,
           language_strength = $9, language_if_unknown = $10, languages = $11,
           employment_strength = $12, employment_if_unknown = $13, employment_types = $14,
           must_have_strength = $15, must_have_if_unknown = $16, updated_at = now()`,
        [
          c.location.area,
          c.location.includeRemote,
          c.location.strength,
          c.location.ifUnknown,
          c.title.strength,
          c.title.words,
          c.avoidInTitle.strength,
          c.avoidInTitle.words,
          c.languages.strength,
          c.languages.ifUnknown,
          c.languages.languages,
          c.employmentType.strength,
          c.employmentType.ifUnknown,
          c.employmentType.types,
          c.mustHaves.strength,
          c.mustHaves.ifUnknown,
        ],
      );
      return loadCriteria(pool);
    },
  );
};
