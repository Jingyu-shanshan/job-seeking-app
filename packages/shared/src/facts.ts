import Type, { type Static } from 'typebox';

export const maxFactLength = 5000;

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
  markdown: Type.String({ pattern: '\\S', maxLength: 200_000 }),
});

export type ImportFactsRequest = Static<typeof ImportFactsRequestSchema>;

export const ImportFactsResponseSchema = Type.Object({
  added: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  facts: Type.Array(FactSchema),
});

export type ImportFactsResponse = Static<typeof ImportFactsResponseSchema>;
