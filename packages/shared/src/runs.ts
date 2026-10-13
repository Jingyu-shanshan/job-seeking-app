import Type, { type Static } from 'typebox';
import { CriteriaSchema } from './criteria.ts';
const uuid = Type.String({ format: 'uuid' });
const count = (maximum: number) => Type.Integer({ minimum: 0, maximum });
export const RunConfigSchema = Type.Object(
  {
    name: Type.String({ pattern: '\\S', maxLength: 100 }),
    discoveryLimit: count(500),
    materialLimit: count(100),
    submissionLimit: count(5),
    requestLimit: Type.Integer({ minimum: 1, maximum: 500 }),
    timeLimitSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
    costLimitUsd: Type.Number({ minimum: 0, maximum: 100 }),
    intervalHours: count(168),
  },
  { additionalProperties: false },
);
export type RunConfig = Static<typeof RunConfigSchema>;
export const RunPresetSchema = Type.Object({ id: uuid, config: RunConfigSchema });
export type RunPreset = Static<typeof RunPresetSchema>;
export const RunSchema = Type.Object({
  id: uuid,
  presetId: Type.Union([uuid, Type.Null()]),
  config: RunConfigSchema,
  criteria: CriteriaSchema,
  sources: Type.Array(
    Type.Object({
      id: uuid,
      catalogId: Type.String(),
      param: Type.String(),
      enabled: Type.Boolean(),
    }),
  ),
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('running'),
    Type.Literal('paused'),
    Type.Literal('ready'),
    Type.Literal('failed'),
  ]),
  message: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  requests: Type.Integer(),
  materials: Type.Integer(),
  submissions: Type.Integer(),
  elapsedSeconds: Type.Number(),
  costUsd: Type.Number(),
  jobs: Type.Array(
    Type.Object({ id: uuid, title: Type.String(), stage: Type.String(), message: Type.String() }),
  ),
});
export type Run = Static<typeof RunSchema>;
export const RunsResponseSchema = Type.Object({
  presets: Type.Array(RunPresetSchema),
  runs: Type.Array(RunSchema),
});
export type RunsResponse = Static<typeof RunsResponseSchema>;
export const StartRunSchema = Type.Object({ presetId: uuid }, { additionalProperties: false });
export const StartFillRequestSchema = Type.Object(
  { runId: Type.Optional(uuid) },
  { additionalProperties: false },
);
