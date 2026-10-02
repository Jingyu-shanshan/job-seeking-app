import {
  SummaryFieldsSchema,
  type Quoted,
  type RequirementKind,
  type SummaryFieldKey,
  type SummaryFields,
} from '@jsa/shared';
import Type from 'typebox';
import { Value } from 'typebox/value';
import { quoteFinder } from './quote.ts';

export const summaryFieldKeys = Object.keys(SummaryFieldsSchema.properties) as SummaryFieldKey[];

const Statement = Type.Object({
  text: Type.String({ maxLength: 1000 }),
  quote: Type.String({ maxLength: 2000 }),
});

const FieldValue = Type.Union([
  Type.Object({ value: Type.String({ maxLength: 1000 }), quote: Type.String({ maxLength: 2000 }) }),
  Type.Null(),
]);

export const SummaryAnswerSchema = Type.Object({
  responsibilities: Type.Array(Statement, { maxItems: 50 }),
  requirements: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal('must'), Type.Literal('nice')]),
      text: Type.String({ maxLength: 1000 }),
      quote: Type.String({ maxLength: 2000 }),
    }),
    { maxItems: 80 },
  ),
  fields: Type.Object(
    Object.fromEntries(summaryFieldKeys.map((key) => [key, Type.Optional(FieldValue)])),
  ),
});

export interface CheckedSummary {
  responsibilities: Quoted[];
  requirements: (Quoted & { kind: RequirementKind })[];
  fields: SummaryFields;
}

export function checkSummaryAnswer(text: string, answer: unknown): CheckedSummary | undefined {
  if (!Value.Check(SummaryAnswerSchema, answer)) return undefined;
  const find = quoteFinder(text);
  const verbatim = (quote: string) => find(quote) >= 0;
  const quoted = (item: { text: string; quote: string }): Quoted => ({
    text: item.text.trim(),
    quote: item.quote.trim(),
    quoteVerified: verbatim(item.quote),
  });

  const fields = Object.fromEntries(
    summaryFieldKeys.map((key) => {
      const field = (answer.fields as Record<string, { value: string; quote: string } | null>)[key];
      const value = field?.value.trim() ?? '';
      if (!field || value === '') return [key, null];
      return [key, { value, quote: field.quote.trim(), quoteVerified: verbatim(field.quote) }];
    }),
  ) as SummaryFields;

  return {
    responsibilities: answer.responsibilities.map(quoted).filter((item) => item.text !== ''),
    requirements: answer.requirements
      .map((item) => ({ ...quoted(item), kind: item.kind }))
      .filter((item) => item.text !== ''),
    fields,
  };
}
