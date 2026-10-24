import Type, { type Static } from 'typebox';

export const JobSearchSourceSchema = Type.Union([
  Type.Literal('greenhouse_board'),
  Type.Literal('ashby_board'),
]);
export type JobSearchSource = Static<typeof JobSearchSourceSchema>;
export const JobSearchRequestSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    role: Type.String({ minLength: 1, maxLength: 100 }),
    location: Type.String({ minLength: 1, maxLength: 100 }),
    sources: Type.Array(JobSearchSourceSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
    maxCostUsd: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type JobSearchRequest = Static<typeof JobSearchRequestSchema>;
export interface JobSearchCandidate {
  url: string;
  title: string;
  snippet: string;
  source: JobSearchSource;
}
export interface JobSearchResponse {
  id: string;
  query: string;
  createdAt: string;
  costUsd: number;
  estimated: boolean;
  message: string;
  candidates: JobSearchCandidate[];
  ignored: { title: string; reason: string }[];
}
