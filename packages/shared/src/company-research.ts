import Type, { type Static } from 'typebox';

export const CompanyResearchRequestSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    company: Type.String({ minLength: 1, maxLength: 80 }),
    website: Type.String({ minLength: 1, maxLength: 2000 }),
    topic: Type.Union([Type.Literal('products'), Type.Literal('news')]),
    maxCostUsd: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type CompanyResearchRequest = Static<typeof CompanyResearchRequestSchema>;

export interface CompanyResearchSource {
  url: string;
  finalUrl: string;
  title: string;
  readAt: string;
  method: 'public_page';
  text: string;
  truncated: boolean;
}

export interface CompanyResearch {
  id: string;
  company: string;
  website: string;
  topic: CompanyResearchRequest['topic'];
  query: string;
  createdAt: string;
  status: 'pending' | 'completed' | 'failed';
  message: string;
  sources: CompanyResearchSource[];
  issues: string[];
  costUsd: number;
  estimated: boolean;
}

export interface CompanyResearchState {
  available: boolean;
  estimatedCostUsd: number;
  versions: CompanyResearch[];
}
