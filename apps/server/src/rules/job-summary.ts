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

// 模型对一份职位原文的回答（T05）：职责、要求（必须项/加分项）和固定字段，每一条都带原文引用。
// 这里只检查回答的形状并对每条引用做子串校验；模型的回答是不可信数据，校验不过的条目照样保存，
// 但标为待确认，界面不把它们当作原文的内容。

/** 总结固定包含的字段，顺序即界面上的顺序。 */
export const summaryFieldKeys = Object.keys(SummaryFieldsSchema.properties) as SummaryFieldKey[];

const Statement = Type.Object({
  text: Type.String({ maxLength: 1000 }),
  quote: Type.String({ maxLength: 2000 }),
});

const FieldValue = Type.Union([
  Type.Object({ value: Type.String({ maxLength: 1000 }), quote: Type.String({ maxLength: 2000 }) }),
  Type.Null(),
]);

/** 模型回答应有的形状。漏掉的字段视为原文没有说明；多出的键忽略。 */
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

/**
 * 检查模型回答的形状，并对每条引用做子串校验。形状不对时返回 undefined。
 * 文字为空的条目丢掉，值为空的字段算没有说明。
 */
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
