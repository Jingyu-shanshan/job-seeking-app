import type {
  Criteria,
  CriterionResult,
  FactKind,
  JobVerdict,
  Outcome,
  RequirementKind,
  SummaryFields,
} from '@jsa/shared';
import type { Pool } from 'pg';
import { loadFacts } from '../facts/routes.ts';
import { checkJob } from '../rules/criteria.ts';
import { mustHavesOutcome } from '../rules/match.ts';
import { loadCriteria } from './criteria.ts';

// Loads what the criteria are checked against and checks jobs (T06). Used by the job list and the
// job page, so both show the same verdict.

export interface FactState {
  /** Current versions of confirmed facts: evidence that cites anything else no longer counts. */
  valid: Set<string>;
  /** What a match sends: current versions that `mayUse(..., 'model')` allows. */
  sendable: { versionId: string; kind: FactKind; body: string }[];
  /** Every version, current or not, by id. */
  versions: Map<string, { factId: string; version: number; body: string }>;
}

export async function loadFactState(pool: Pool): Promise<FactState> {
  const facts = await loadFacts(pool);
  const versions: FactState['versions'] = new Map();
  for (const fact of facts) {
    for (const v of [fact.current, ...fact.earlier]) {
      versions.set(v.id, { factId: fact.id, version: v.version, body: v.body });
    }
  }
  return {
    valid: new Set(facts.filter((f) => f.current.status === 'confirmed').map((f) => f.current.id)),
    sendable: facts
      .filter((f) => f.sendableToModel)
      .map((f) => ({ versionId: f.current.id, kind: f.kind, body: f.current.body })),
    versions,
  };
}

export interface MatchedRequirement {
  outcome: Outcome;
  note: string;
  factVersionIds: string[];
}

export interface LatestMatch {
  id: string;
  createdAt: Date;
  model: string;
  costUsd: number;
  sentFacts: string[];
  requirements: Map<string, MatchedRequirement>;
}

/** The latest match of each snapshot that has one. */
export async function latestMatches(
  pool: Pool,
  snapshotIds: readonly string[],
): Promise<Map<string, LatestMatch>> {
  const matches = new Map<string, LatestMatch>();
  if (snapshotIds.length === 0) return matches;
  const { rows } = await pool.query<{
    id: string;
    job_snapshot_id: string;
    created_at: Date;
    model: string;
    cost_usd: string;
    sent_facts: string[];
  }>(
    `select distinct on (m.job_snapshot_id) m.id, m.job_snapshot_id, m.created_at, c.model,
       c.cost_usd,
       array(select f.fact_version_id::text from match_fact f where f.match_id = m.id) as sent_facts
     from match m join model_call c on c.id = m.model_call_id
     where m.job_snapshot_id = any($1)
     order by m.job_snapshot_id, m.created_at desc, m.id`,
    [snapshotIds],
  );
  const bySnapshot = new Map<string, LatestMatch>();
  for (const row of rows) {
    bySnapshot.set(row.id, {
      id: row.id,
      createdAt: row.created_at,
      model: row.model,
      costUsd: Number(row.cost_usd),
      sentFacts: row.sent_facts,
      requirements: new Map(),
    });
    matches.set(row.job_snapshot_id, bySnapshot.get(row.id)!);
  }
  const outcomes = await pool.query<{
    match_id: string;
    job_requirement_id: string;
    outcome: Outcome;
    note: string;
    facts: string[];
  }>(
    `select r.match_id, r.job_requirement_id, r.outcome, r.note,
       array(select e.fact_version_id::text from match_evidence e
             where e.match_id = r.match_id and e.job_requirement_id = r.job_requirement_id
             order by e.fact_version_id) as facts
     from match_requirement r where r.match_id = any($1)`,
    [[...bySnapshot.keys()]],
  );
  for (const row of outcomes.rows) {
    bySnapshot.get(row.match_id)!.requirements.set(row.job_requirement_id, {
      outcome: row.outcome,
      note: row.note,
      factVersionIds: row.facts,
    });
  }
  return matches;
}

interface CurrentText {
  snapshotId: string;
  fields: SummaryFields | null;
  requirements: {
    id: string;
    text: string;
    quote: string;
    kind: RequirementKind;
    verified: boolean;
  }[];
}

/** Each job's current text: the snapshot read last, its summary fields and its requirements. */
async function currentTexts(pool: Pool, jobIds: readonly string[]) {
  const texts = new Map<string, CurrentText>();
  const { rows } = await pool.query<{ job_id: string; id: string; fields: SummaryFields | null }>(
    `select distinct on (s.job_id) s.job_id, s.id, j.fields
     from job_snapshot s left join job_summary j on j.job_snapshot_id = s.id
     where s.job_id = any($1)
     order by s.job_id, s.last_captured_at desc, s.captured_at desc`,
    [jobIds],
  );
  const bySnapshot = new Map<string, CurrentText>();
  for (const row of rows) {
    const text: CurrentText = { snapshotId: row.id, fields: row.fields, requirements: [] };
    texts.set(row.job_id, text);
    bySnapshot.set(row.id, text);
  }
  const requirements = await pool.query<{
    id: string;
    job_snapshot_id: string;
    body: string;
    quote: string;
    kind: RequirementKind;
    quote_verified: boolean;
  }>(
    `select id, job_snapshot_id, body, quote, kind, quote_verified from job_requirement
     where job_snapshot_id = any($1) and removed_at is null
     order by created_at, id`,
    [[...bySnapshot.keys()]],
  );
  for (const r of requirements.rows) {
    bySnapshot.get(r.job_snapshot_id)!.requirements.push({
      id: r.id,
      text: r.body,
      quote: r.quote,
      kind: r.kind,
      verified: r.quote_verified,
    });
  }
  return texts;
}

export interface JobCheck {
  verdict: JobVerdict;
  criteria: CriterionResult[];
}

/** Checks jobs, described as the job list describes them, against the user's criteria. */
export async function checkJobs(
  pool: Pool,
  jobs: readonly { id: string; title: string; location: string }[],
  given?: Criteria,
): Promise<Map<string, JobCheck>> {
  const criteria = given ?? (await loadCriteria(pool));
  const texts = await currentTexts(
    pool,
    jobs.map((job) => job.id),
  );
  const usesMatches = criteria.mustHaves.strength !== 'off';
  const [facts, matches] = usesMatches
    ? await Promise.all([
        loadFactState(pool),
        latestMatches(
          pool,
          [...texts.values()].map((text) => text.snapshotId),
        ),
      ])
    : [undefined, new Map<string, LatestMatch>()];

  const checks = new Map<string, JobCheck>();
  for (const job of jobs) {
    const text = texts.get(job.id);
    const summary = !text
      ? 'none'
      : !text.fields
        ? 'unsummarised'
        : {
            languages: text.fields.languages ?? null,
            employmentType: text.fields.employmentType ?? null,
          };
    const mustHaves = mustHavesOutcome({
      hasText: text !== undefined,
      requirementsKnown:
        text !== undefined && (text.fields !== null || text.requirements.length > 0),
      mustHaves: (text?.requirements ?? []).filter((r) => r.kind === 'must' && r.verified),
      matched: text && matches.get(text.snapshotId)?.requirements,
      validFactVersions: facts?.valid ?? new Set(),
    });
    checks.set(
      job.id,
      checkJob({ title: job.title, location: job.location, summary, mustHaves }, criteria),
    );
  }
  return checks;
}
