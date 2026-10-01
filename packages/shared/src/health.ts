import Type, { type Static } from 'typebox';

/** Response of `GET /health`: the process is up. Says nothing about the database. */
export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;

/** Response of `GET /health/ready`: `ok` (200) when the database answers, else `unavailable` (503). */
export const ReadyResponseSchema = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]),
});

export type ReadyResponse = Static<typeof ReadyResponseSchema>;
