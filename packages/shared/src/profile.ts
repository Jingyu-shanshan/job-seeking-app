import Type, { type Static } from 'typebox';

/**
 * The user's details (T08): the app writes them into the documents' header and never sends them
 * to DeepSeek. An empty field is left out of documents.
 */
export const ProfileSchema = Type.Object({
  name: Type.String({ maxLength: 100 }),
  email: Type.String({ maxLength: 200 }),
  phone: Type.String({ maxLength: 40 }),
  /** Where the user lives, as documents should say it, such as a city. */
  location: Type.String({ maxLength: 100 }),
  /** Public pages such as a portfolio, GitHub or LinkedIn: https links. */
  links: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 3 }),
});

export type Profile = Static<typeof ProfileSchema>;
