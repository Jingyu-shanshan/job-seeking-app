import Type, { type Static } from 'typebox';
import { maxFactImportCandidates, maxFactImportTextLength, maxFactLength } from './limits.ts';

export { maxFactLength } from './limits.ts';

export const FactKindSchema = Type.Union([
  Type.Literal('experience'),
  Type.Literal('project'),
  Type.Literal('education'),
  Type.Literal('skill'),
  Type.Literal('language'),
  Type.Literal('certification'),
  Type.Literal('statement'),
  Type.Literal('other'),
]);

export type FactKind = Static<typeof FactKindSchema>;

export const FactStatusSchema = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('confirmed'),
  Type.Literal('retired'),
]);

export type FactStatus = Static<typeof FactStatusSchema>;

export const FactVersionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  version: Type.Integer({ minimum: 1 }),
  body: Type.String(),
  source: Type.String(),
  status: FactStatusSchema,
  maySendToModel: Type.Boolean(),
  mayUseInMaterials: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
});

export type FactVersion = Static<typeof FactVersionSchema>;

export const FactSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: FactKindSchema,
  createdAt: Type.String({ format: 'date-time' }),
  current: FactVersionSchema,
  earlier: Type.Array(FactVersionSchema),
  sendableToModel: Type.Boolean(),
  usableInMaterials: Type.Boolean(),
  sensitive: Type.Array(Type.String()),
});

export type Fact = Static<typeof FactSchema>;

export const FactsResponseSchema = Type.Object({
  facts: Type.Array(FactSchema),
});

export type FactsResponse = Static<typeof FactsResponseSchema>;

export const AddFactRequestSchema = Type.Object({
  kind: FactKindSchema,
  body: Type.String({ pattern: '\\S', maxLength: maxFactLength }),
});

export type AddFactRequest = Static<typeof AddFactRequestSchema>;

export const EditFactRequestSchema = Type.Object({
  body: Type.String({ pattern: '\\S', maxLength: maxFactLength }),
});

export type EditFactRequest = Static<typeof EditFactRequestSchema>;

export const UpdateFactVersionRequestSchema = Type.Object(
  {
    status: Type.Optional(FactStatusSchema),
    maySendToModel: Type.Optional(Type.Boolean()),
    mayUseInMaterials: Type.Optional(Type.Boolean()),
  },
  { minProperties: 1 },
);

export type UpdateFactVersionRequest = Static<typeof UpdateFactVersionRequestSchema>;

export const ImportFactsRequestSchema = Type.Object({
  markdown: Type.String({ pattern: '\\S', maxLength: maxFactImportTextLength }),
});

export type ImportFactsRequest = Static<typeof ImportFactsRequestSchema>;

export const ImportFactsResponseSchema = Type.Object({
  added: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  facts: Type.Array(FactSchema),
});

export type ImportFactsResponse = Static<typeof ImportFactsResponseSchema>;

const fileName = Type.String({ maxLength: 255, pattern: '^[^\\u0000-\\u001f]*$' });
const sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
export const FactImportSourceSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('pdf'),
      fileName: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^\\u0000-\\u001f]+$' }),
      sha256,
      pages: Type.Array(Type.Integer({ minimum: 1, maximum: 20 }), {
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
      }),
      edited: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('markdown'), fileName, sha256, edited: Type.Boolean() },
    { additionalProperties: false },
  ),
]);
export type FactImportSource = Static<typeof FactImportSourceSchema>;

export const FactCandidateSchema = Type.Object({
  kind: FactKindSchema,
  body: Type.String({ maxLength: maxFactImportTextLength }),
  source: FactImportSourceSchema,
  selected: Type.Boolean(),
});
export type FactCandidate = Static<typeof FactCandidateSchema>;

export const FactDuplicateSchema = Type.Object({
  status: Type.Union([Type.Literal('active'), Type.Literal('retired'), Type.Literal('batch')]),
  factId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});
export type FactDuplicate = Static<typeof FactDuplicateSchema>;

export const PreviewFactsMarkdownRequestSchema = Type.Object({
  markdown: ImportFactsRequestSchema.properties.markdown,
  fileName: Type.Optional(fileName),
});
export const PreviewFactsResponseSchema = Type.Object({
  pages: Type.Array(
    Type.Object({
      page: Type.Integer({ minimum: 1, maximum: 20 }),
      text: Type.String({ maxLength: maxFactImportTextLength }),
    }),
    { maxItems: 20 },
  ),
  candidates: Type.Array(
    Type.Object({
      ...FactCandidateSchema.properties,
      duplicate: Type.Union([FactDuplicateSchema, Type.Null()]),
    }),
    { maxItems: maxFactImportCandidates },
  ),
});
export type PreviewFactsResponse = Static<typeof PreviewFactsResponseSchema>;

export const SaveFactCandidatesRequestSchema = Type.Object({
  candidates: Type.Array(FactCandidateSchema, { maxItems: maxFactImportCandidates }),
});
export const SaveFactCandidatesResponseSchema = Type.Object({
  ...ImportFactsResponseSchema.properties,
  cancelled: Type.Integer({ minimum: 0 }),
  duplicates: Type.Array(
    Type.Object({ index: Type.Integer({ minimum: 0 }), ...FactDuplicateSchema.properties }),
    { maxItems: maxFactImportCandidates },
  ),
});
export type SaveFactCandidatesResponse = Static<typeof SaveFactCandidatesResponseSchema>;

/** A fact version a match or a draft cites, with its text as it was. */
export const CitedFactSchema = Type.Object({
  versionId: Type.String({ format: 'uuid' }),
  factId: Type.String({ format: 'uuid' }),
  version: Type.Integer({ minimum: 1 }),
  body: Type.String(),
  /**
   * False when the fact has a newer version or is no longer confirmed: a match outcome that cites
   * it no longer counts and the requirement is unknown until it is matched again. For a draft it
   * is also false when the fact may no longer appear in documents, and the statement is left out.
   */
  current: Type.Boolean(),
});

export type CitedFact = Static<typeof CitedFactSchema>;
