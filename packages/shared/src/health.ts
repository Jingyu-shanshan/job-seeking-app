import Type, { type Static } from 'typebox';

/** Response of `GET /health`: the process is up. Says nothing about the database. */
export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
