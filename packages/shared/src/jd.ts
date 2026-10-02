import Type, { type Static } from 'typebox';
import { JobSourceSchema } from './jobs.ts';

// JD 导入与总结（T05）的接口契约。职位原文存为不可修改的快照；模型抽取的每一条要求和总结都引用
// 原文片段，`quoteVerified` 是子串校验的结果。校验不过的条目是“待确认”，不算原文里的内容。

/** 职位原文最多这么多字符，粘贴和从来源读取都一样。 */
export const maxJobTextLength = 100_000;

/** 一条引用原文的陈述：文字、它引用的原文片段，以及片段是否逐字出现在原文里。 */
export const QuotedSchema = Type.Object({
  text: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
});

export type Quoted = Static<typeof QuotedSchema>;

/** 必须项或加分项。原文没有标明可选的要求算必须项。 */
export const RequirementKindSchema = Type.Union([Type.Literal('must'), Type.Literal('nice')]);

export type RequirementKind = Static<typeof RequirementKindSchema>;

/** 从一个快照抽取的要求。`origin` 说明是模型抽取的还是用户更正时添加的。 */
export const RequirementSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  text: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
  kind: RequirementKindSchema,
  origin: Type.Union([Type.Literal('model'), Type.Literal('user')]),
});

export type Requirement = Static<typeof RequirementSchema>;

/** 总结里一个字段的值，及其原文引用。 */
export const SummaryFieldValueSchema = Type.Object({
  value: Type.String(),
  quote: Type.String(),
  quoteVerified: Type.Boolean(),
});

export type SummaryFieldValue = Static<typeof SummaryFieldValueSchema>;

const summaryField = Type.Union([SummaryFieldValueSchema, Type.Null()]);

/**
 * 总结固定包含的字段，只看职位原文。null 表示原文没有说明，保持未知，不由模型推断
 * （例如英文 JD 不等于工作语言是英语）。
 */
export const SummaryFieldsSchema = Type.Object({
  /** 工作地点。 */
  location: summaryField,
  /** 远程、混合或到岗办公，以及到岗频率。 */
  workplace: summaryField,
  /** 全职、兼职、固定期限、合同或实习。 */
  employmentType: summaryField,
  /** 工作中要求或使用的语言。 */
  languages: summaryField,
  /** 职级或要求的工作年限。 */
  seniority: summaryField,
  /** 薪资或薪资范围。 */
  salary: summaryField,
  /** 是否提供签证担保，或是否要求已有工作许可。 */
  visaSponsorship: summaryField,
});

export type SummaryFields = Static<typeof SummaryFieldsSchema>;
export type SummaryFieldKey = keyof SummaryFields;

/** 模型对一个快照的总结。必须项和加分项是该快照的要求（`Snapshot.requirements`）。 */
export const JobSummarySchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  model: Type.String(),
  /** 这次模型调用按高峰时段价格估算的费用（美元）。 */
  costUsd: Type.Number({ minimum: 0 }),
  responsibilities: Type.Array(QuotedSchema),
  fields: SummaryFieldsSchema,
});

export type JobSummary = Static<typeof JobSummarySchema>;

/** 一次抓取或粘贴的职位原文，抓取时来源给出的标题等信息，以及从它抽取的总结和要求。 */
export const SnapshotSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  capturedAt: Type.String({ format: 'date-time' }),
  /** 原文从哪个目录项来，例如 `greenhouse_board`；粘贴的是 `paste`。 */
  catalogId: Type.String(),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  /** 职位页面，总是 https。 */
  url: Type.String(),
  text: Type.String(),
  /** 还没有总结时为 null。 */
  summary: Type.Union([JobSummarySchema, Type.Null()]),
  /** 当前的要求；用户移除的不在其中。 */
  requirements: Type.Array(RequirementSchema),
});

export type Snapshot = Static<typeof SnapshotSchema>;

/** `GET /api/jobs/:id` 的回答：一个职位、它最新的快照，以及更早的快照有几个。 */
export const JobDetailSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  company: Type.Union([Type.String(), Type.Null()]),
  location: Type.String(),
  url: Type.String(),
  /** 现在列出该职位、且仍在使用的来源；粘贴的职位或不再被列出的职位为空。 */
  sources: Type.Array(JobSourceSchema),
  /** 应用现在能否从其中一个来源读取原文。 */
  canImport: Type.Boolean(),
  snapshot: Type.Union([SnapshotSchema, Type.Null()]),
  earlierSnapshots: Type.Integer({ minimum: 0 }),
});

export type JobDetail = Static<typeof JobDetailSchema>;

/** `POST /api/jobs` 的请求体：粘贴一个职位的链接和原文，以及标题等信息。 */
export const PasteJobRequestSchema = Type.Object({
  title: Type.String({ pattern: '\\S', maxLength: 1000 }),
  company: Type.Optional(Type.String({ maxLength: 1000 })),
  location: Type.Optional(Type.String({ maxLength: 5000 })),
  url: Type.String({ pattern: '^https://\\S+$', maxLength: 2000 }),
  text: Type.String({ pattern: '\\S', maxLength: maxJobTextLength }),
});

export type PasteJobRequest = Static<typeof PasteJobRequestSchema>;

/**
 * `POST /api/snapshots/:id/requirements` 的请求体：用户添加一条要求，给出 `replaces` 时同时移除那一条
 * （即更正）。引用片段同样做子串校验，校验不过的要求是待确认。
 */
export const AddRequirementRequestSchema = Type.Object({
  text: Type.String({ pattern: '\\S', maxLength: 1000 }),
  quote: Type.String({ maxLength: 1000 }),
  kind: RequirementKindSchema,
  replaces: Type.Optional(Type.String({ format: 'uuid' })),
});

export type AddRequirementRequest = Static<typeof AddRequirementRequestSchema>;

/** `GET /api/model-usage` 的回答：至今的模型调用次数、失败次数、估算费用和 token 数。 */
export const ModelUsageSchema = Type.Object({
  calls: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  costUsd: Type.Number({ minimum: 0 }),
  inputTokens: Type.Integer({ minimum: 0 }),
  outputTokens: Type.Integer({ minimum: 0 }),
});

export type ModelUsage = Static<typeof ModelUsageSchema>;
