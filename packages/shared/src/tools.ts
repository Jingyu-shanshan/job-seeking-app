import Type, { type Static } from 'typebox';

export const WebToolSchema = Type.Union([Type.Literal('search'), Type.Literal('fetch')]);
export const ToolRequestSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    tool: WebToolSchema,
    input: Type.String({ minLength: 1, maxLength: 2000 }),
    maxCostUsd: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type ToolRequest = Static<typeof ToolRequestSchema>;
export const SearchResultSchema = Type.Object({
  title: Type.String({ maxLength: 10000 }),
  url: Type.String({ maxLength: 8192 }),
  snippet: Type.String({ maxLength: 100000 }),
  summary: Type.String({ maxLength: 100000 }),
  content: Type.String({ maxLength: 1000000 }),
});
export const SearchResponseSchema = Type.Object({
  results: Type.Array(SearchResultSchema, { maxItems: 50 }),
});
export const FetchResponseSchema = Type.Object({
  title: Type.String({ maxLength: 10000 }),
  content: Type.String({ maxLength: 1000000 }),
});
export type ToolResult = Static<typeof SearchResponseSchema> | Static<typeof FetchResponseSchema>;
export interface ToolCall {
  id: string;
  tool: ToolRequest['tool'];
  input: string;
  createdAt: string;
  result: ToolResult | null;
  message: string;
  costUsd: number;
  estimated: boolean;
}
export interface ToolCalls {
  available: boolean;
  estimatedCostUsd: number;
  calls: ToolCall[];
}
