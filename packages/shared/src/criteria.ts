import Type, { type Static } from 'typebox';

/**
 * How much a criterion counts: `hard` decides whether a job is eligible, `preference` is only
 * shown, `off` is not checked.
 */
export const CriterionStrengthSchema = Type.Union([
  Type.Literal('hard'),
  Type.Literal('preference'),
  Type.Literal('off'),
]);

export type CriterionStrength = Static<typeof CriterionStrengthSchema>;

/**
 * What a hard criterion does when the job does not say: the job goes to to-confirm, or it is
 * ruled out for lack of information. Either way an unknown never counts as met.
 */
export const IfUnknownSchema = Type.Union([Type.Literal('to_confirm'), Type.Literal('rule_out')]);

export type IfUnknown = Static<typeof IfUnknownSchema>;

export const EmploymentTypeSchema = Type.Union([
  Type.Literal('full_time'),
  Type.Literal('part_time'),
  Type.Literal('permanent'),
  Type.Literal('fixed_term'),
  Type.Literal('contract'),
  Type.Literal('internship'),
]);

export type EmploymentType = Static<typeof EmploymentTypeSchema>;

const Words = Type.Array(Type.String({ pattern: '\\S', maxLength: 100 }), { maxItems: 50 });

/**
 * The user's criteria. A criterion that is not off needs at least one word, language or type.
 * The location criterion's value is the search scope: `helsinki` means Helsinki and Espoo, not
 * Vantaa (user decision, 2026-10-01); `worldwide` includes remote jobs, whatever `includeRemote`
 * says.
 */
export const CriteriaSchema = Type.Object({
  location: Type.Object({
    strength: CriterionStrengthSchema,
    ifUnknown: IfUnknownSchema,
    area: Type.Union([
      Type.Literal('helsinki'),
      Type.Literal('finland'),
      Type.Literal('worldwide'),
    ]),
    includeRemote: Type.Boolean(),
  }),
  /** Words the title should have, any of them. The title is always known. */
  title: Type.Object({ strength: CriterionStrengthSchema, words: Words }),
  /** Words the title should not have. */
  avoidInTitle: Type.Object({ strength: CriterionStrengthSchema, words: Words }),
  /** Languages the user can work in, compared with the summary's working languages. */
  languages: Type.Object({
    strength: CriterionStrengthSchema,
    ifUnknown: IfUnknownSchema,
    languages: Words,
  }),
  /** Employment types the user accepts, compared with the summary's employment type. */
  employmentType: Type.Object({
    strength: CriterionStrengthSchema,
    ifUnknown: IfUnknownSchema,
    types: Type.Array(EmploymentTypeSchema, { maxItems: 6 }),
  }),
  /** Whether the user's facts meet the job's must-haves, from the latest evidence match. */
  mustHaves: Type.Object({ strength: CriterionStrengthSchema, ifUnknown: IfUnknownSchema }),
});

export type Criteria = Static<typeof CriteriaSchema>;
export type CriterionKey = keyof Criteria;

export const OutcomeSchema = Type.Union([
  Type.Literal('met'),
  Type.Literal('unmet'),
  Type.Literal('unknown'),
]);

export type Outcome = Static<typeof OutcomeSchema>;

/** Whether a job is eligible by the user's hard criteria. Computed when read, never stored. */
export const JobVerdictSchema = Type.Union([
  Type.Literal('eligible'),
  Type.Literal('to_confirm'),
  Type.Literal('ineligible'),
]);

export type JobVerdict = Static<typeof JobVerdictSchema>;

/** One criterion checked against one job. */
export const CriterionResultSchema = Type.Object({
  criterion: Type.Union([
    Type.Literal('location'),
    Type.Literal('title'),
    Type.Literal('avoidInTitle'),
    Type.Literal('languages'),
    Type.Literal('employmentType'),
    Type.Literal('mustHaves'),
  ]),
  strength: Type.Union([Type.Literal('hard'), Type.Literal('preference')]),
  outcome: OutcomeSchema,
  /** What the outcome does to the job: only hard criteria rule a job out or send it to confirm. */
  effect: Type.Union([Type.Literal('rules_out'), Type.Literal('to_confirm'), Type.Literal('none')]),
  reason: Type.String(),
  /** The job text the outcome rests on, verbatim; null when it rests on none. */
  quote: Type.Union([Type.String(), Type.Null()]),
});

export type CriterionResult = Static<typeof CriterionResultSchema>;
