import Type, { type Static } from 'typebox';

const uuid = Type.String({ format: 'uuid' });
const text = Type.String({ minLength: 1, maxLength: 2000 });
const refs = Type.Array(Type.String(), { minItems: 1, maxItems: 20, uniqueItems: true });
const question = Type.Object({ text, sources: refs }, { additionalProperties: false });

/** All model prose is practice material; stories never become confirmed facts. */
export const InterviewAnswerSchema = Type.Object(
  {
    technical: Type.Array(question, { minItems: 1, maxItems: 12 }),
    projects: Type.Array(question, { minItems: 1, maxItems: 12 }),
    stories: Type.Array(
      Type.Object(
        {
          title: text,
          situation: Type.Union([text, Type.Null()]),
          task: Type.Union([text, Type.Null()]),
          action: Type.Union([text, Type.Null()]),
          result: Type.Union([text, Type.Null()]),
          missing: Type.Array(text, { maxItems: 12 }),
          sources: refs,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 6 },
    ),
    interviewer: Type.Array(question, { minItems: 1, maxItems: 12 }),
  },
  { additionalProperties: false },
);
export type InterviewAnswer = Static<typeof InterviewAnswerSchema>;

export const InterviewSourceSchema = Type.Object({
  ref: Type.String(),
  kind: Type.Union([Type.Literal('job'), Type.Literal('material')]),
  text: Type.String(),
  fileId: Type.Union([uuid, Type.Null()]),
  sha256: Type.Union([Type.String(), Type.Null()]),
  factVersionIds: Type.Array(uuid),
});
export type InterviewSource = Static<typeof InterviewSourceSchema>;

export const InterviewPreparationSchema = Type.Object({
  id: uuid,
  createdAt: Type.String({ format: 'date-time' }),
  model: Type.String(),
  costUsd: Type.Number(),
  sources: Type.Array(InterviewSourceSchema),
  answer: InterviewAnswerSchema,
  notes: Type.String(),
});
export type InterviewPreparation = Static<typeof InterviewPreparationSchema>;

export const InterviewStateSchema = Type.Object({
  applicationId: uuid,
  title: Type.String(),
  cannotGenerate: Type.Union([Type.String(), Type.Null()]),
  sources: Type.Array(InterviewSourceSchema),
  omittedStatements: Type.Integer({ minimum: 0 }),
  externalFiles: Type.Array(
    Type.Object({
      id: uuid,
      fileName: Type.String(),
      sha256: Type.String(),
      text: Type.String(),
      problem: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  preparation: Type.Union([InterviewPreparationSchema, Type.Null()]),
});
export type InterviewState = Static<typeof InterviewStateSchema>;

export const GenerateInterviewRequestSchema = Type.Object(
  {
    excerpts: Type.Array(
      Type.Object({ fileId: uuid, text: Type.String({ minLength: 1, maxLength: 20000 }) }),
      { maxItems: 4 },
    ),
    allowExcerpts: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type GenerateInterviewRequest = Static<typeof GenerateInterviewRequestSchema>;
export const InterviewNotesRequestSchema = Type.Object(
  {
    notes: Type.String({ maxLength: 12000 }),
  },
  { additionalProperties: false },
);
