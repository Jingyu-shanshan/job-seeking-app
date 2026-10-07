import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ProfileSchema, type Profile } from '@jsa/shared';
import type { Pool } from 'pg';
import { httpError } from '../http-error.ts';

// The user's details (T08): one row the app writes into the documents' header. They never go
// into a model request; the statement checks keep contact details out of DeepSeek's text too.

export async function loadProfile(pool: Pool): Promise<Profile> {
  const { rows } = await pool.query<Profile>(
    'select name, email, phone, location, links from profile',
  );
  // The migration inserts the only row; nothing deletes it.
  if (!rows[0]) throw new Error('profile has no row');
  return rows[0];
}

const line = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The details as they are saved, or a 400 that says what to change. */
export function tidyProfile(profile: Profile): Profile {
  const email = line(profile.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'Enter an email address such as name@example.com, or leave it empty.');
  }
  const phone = line(profile.phone);
  if (phone && !/^\+?[\d ()./-]+$/.test(phone)) {
    throw httpError(400, 'A phone number may have only digits, spaces and + ( ) - . /');
  }
  const links: string[] = [];
  for (const entry of profile.links.map(line).filter((entry) => entry !== '')) {
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      // Reported below.
    }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username) {
      throw httpError(400, `“${entry}” is not a web address. Links start with https://.`);
    }
    if (!links.includes(url.href)) links.push(url.href);
  }
  return { name: line(profile.name), email, phone, location: line(profile.location), links };
}

export const profileRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  app.get('/profile', { schema: { response: { 200: ProfileSchema } } }, () => loadProfile(pool));

  app.put(
    '/profile',
    { schema: { body: ProfileSchema, response: { 200: ProfileSchema } } },
    async (request) => {
      const profile = tidyProfile(request.body);
      await pool.query(
        `update profile set name = $1, email = $2, phone = $3, location = $4, links = $5,
           updated_at = now()`,
        [profile.name, profile.email, profile.phone, profile.location, profile.links],
      );
      return profile;
    },
  );
};
