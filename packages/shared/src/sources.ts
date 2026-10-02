import Type, { type Static } from 'typebox';

/**
 * How the app gets jobs from a source. There are only these four:
 * - `board_api`: a company job board's public read API, no login.
 * - `official_api`: a site's official API, with a key the user applied for.
 * - `email_alert`: the user sets up job alerts on the site and imports the alert emails.
 * - `manual`: the user pastes the job's link and text, or saves the page they are looking at in
 *   the desktop app.
 * The app itself requests only `board_api` and `official_api` sources.
 */
export const AccessMethodSchema = Type.Union([
  Type.Literal('board_api'),
  Type.Literal('official_api'),
  Type.Literal('email_alert'),
  Type.Literal('manual'),
]);

export type AccessMethod = Static<typeof AccessMethodSchema>;

/** One site and one way of using it. The catalog is fixed in code; the user picks from it. */
export const CatalogEntrySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  access: AccessMethodSchema,
  /** What using the entry means and, for a site the app does not request itself, why not. */
  note: Type.String(),
  /**
   * When and where the site's terms and access options were last checked (`checkedOn` is
   * YYYY-MM-DD). Null only for pasting, where the user brings the content.
   */
  terms: Type.Union([
    Type.Object({ checkedOn: Type.String({ format: 'date' }), url: Type.String() }),
    Type.Null(),
  ]),
  /** The app's own limit for requests to the site; null when the app never requests it. */
  rateLimit: Type.Union([
    Type.Object({
      requests: Type.Integer({ minimum: 1 }),
      perSeconds: Type.Integer({ minimum: 1 }),
    }),
    Type.Null(),
  ]),
  /**
   * The value each source of this entry needs, such as a job board name, and the pattern it must
   * match. Null when the entry takes none, in which case it is used at most once.
   */
  param: Type.Union([
    Type.Object({ label: Type.String(), hint: Type.String(), pattern: Type.String() }),
    Type.Null(),
  ]),
});

export type CatalogEntry = Static<typeof CatalogEntrySchema>;

/** A catalog entry the user uses, e.g. one Greenhouse board, and its last result. */
export const SourceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  catalogId: Type.String(),
  /** The entry's parameter; '' when the entry takes none. */
  param: Type.String(),
  enabled: Type.Boolean(),
  lastSuccessAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastFailureAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastFailureReason: Type.Union([Type.String(), Type.Null()]),
});

export type Source = Static<typeof SourceSchema>;

/** Response of `GET /api/sources`. */
export const SourcesResponseSchema = Type.Object({
  catalog: Type.Array(CatalogEntrySchema),
  sources: Type.Array(SourceSchema),
});

export type SourcesResponse = Static<typeof SourcesResponseSchema>;

/** Body of `POST /api/sources`. The source starts enabled. */
export const AddSourceRequestSchema = Type.Object({
  catalogId: Type.String({ maxLength: 64 }),
  param: Type.Optional(Type.String({ maxLength: 200 })),
});

export type AddSourceRequest = Static<typeof AddSourceRequestSchema>;

/** Body of `PATCH /api/sources/:id`. */
export const UpdateSourceRequestSchema = Type.Object({
  enabled: Type.Boolean(),
});

export type UpdateSourceRequest = Static<typeof UpdateSourceRequestSchema>;

/**
 * Which jobs count as in scope, by location. It only filters discovered jobs and never changes
 * which sources are used. `helsinki` means Helsinki and Espoo, not Vantaa (user decision,
 * 2026-10-01). `worldwide` includes remote jobs, whatever `includeRemote` says.
 */
export const SearchScopeSchema = Type.Object({
  area: Type.Union([Type.Literal('helsinki'), Type.Literal('finland'), Type.Literal('worldwide')]),
  includeRemote: Type.Boolean(),
});

export type SearchScope = Static<typeof SearchScopeSchema>;
