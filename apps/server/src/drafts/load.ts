import type {
  CitedFact,
  Draft,
  DraftAbout,
  DraftKind,
  DraftLine,
  DraftSection,
  DraftSummary,
} from '@jsa/shared';
import type { Pool } from 'pg';
import type { FactState } from '../matching/check.ts';
import { draftOutdated } from '../rules/draft.ts';
import { isVerbatim, statementProblems, vocabularyOf } from '../rules/statement.ts';

// Reads drafts (T07) and checks their statements against the facts as they are now. The checks
// are never stored: a fact that changes, is withdrawn or may no longer appear in documents takes
// the statements that cite it out of the document at once. A statement the user edited (T08) is
// checked as the user's text, against the same cited facts or quote.

export interface StoredStatement {
  id: string;
  section: DraftSection;
  block: number;
  line: DraftLine;
  about: DraftAbout;
  text: string;
  quote: string | null;
  unsentRefs: string[];
  facts: string[];
  /** The user's latest version, if they made one (T08). */
  edit: { id: string; text: string; included: boolean } | null;
}

export interface StoredDraft {
  id: string;
  kind: DraftKind;
  jobId: string;
  snapshotId: string;
  title: string;
  company: string | null;
  jobText: string;
  createdAt: Date;
  model: string;
  costUsd: number;
  sentFacts: string[];
  /** Whether the job has a newer text than the one the draft was written for. */
  newerText: boolean;
  /** PDFs of it the app kept. */
  pdfs: number;
  statements: StoredStatement[];
}

async function loadStored(pool: Pool, ids: readonly string[]): Promise<StoredDraft[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{
    id: string;
    kind: DraftKind;
    job_id: string;
    job_snapshot_id: string;
    title: string;
    company: string | null;
    body: string;
    created_at: Date;
    model: string;
    cost_usd: string;
    sent_facts: string[];
    newer_text: boolean;
    pdfs: number;
  }>(
    `select a.id, a.kind, s.job_id, a.job_snapshot_id, s.title, s.company, s.body, a.created_at,
       c.model, c.cost_usd,
       array(select f.fact_version_id::text from artifact_fact f where f.artifact_id = a.id)
         as sent_facts,
       s.id <> (select n.id from job_snapshot n where n.job_id = s.job_id
                order by n.last_captured_at desc, n.captured_at desc limit 1) as newer_text,
       (select count(*)::int from document_pdf p where p.artifact_id = a.id) as pdfs
     from artifact a
       join model_call c on c.id = a.model_call_id
       join job_snapshot s on s.id = a.job_snapshot_id
     where a.id = any($1)
     order by a.kind desc, a.created_at`,
    [ids],
  );
  const drafts = new Map<string, StoredDraft>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        kind: row.kind,
        jobId: row.job_id,
        snapshotId: row.job_snapshot_id,
        title: row.title,
        company: row.company,
        jobText: row.body,
        createdAt: row.created_at,
        model: row.model,
        costUsd: Number(row.cost_usd),
        sentFacts: row.sent_facts,
        newerText: row.newer_text,
        pdfs: row.pdfs,
        statements: [],
      },
    ]),
  );
  const statements = await pool.query<{
    artifact_id: string;
    id: string;
    section: DraftSection;
    block: number;
    line: DraftLine;
    about: DraftAbout;
    body: string;
    quote: string | null;
    unsent_refs: string[];
    facts: string[];
    edit_id: string | null;
    edit_body: string | null;
    edit_included: boolean | null;
  }>(
    `select c.artifact_id, c.id, c.section, c.block, c.line, c.about, c.body, c.quote,
       c.unsent_refs,
       array(select f.fact_version_id::text from artifact_claim_fact f
             where f.artifact_claim_id = c.id order by f.fact_version_id) as facts,
       e.id as edit_id, e.body as edit_body, e.included as edit_included
     from artifact_claim c
       left join lateral (
         select e.id, e.body, e.included from artifact_claim_edit e
         where e.artifact_claim_id = c.id order by e.created_at desc limit 1
       ) e on true
     where c.artifact_id = any($1)
     order by c.artifact_id, c.position`,
    [ids],
  );
  for (const row of statements.rows) {
    drafts.get(row.artifact_id)!.statements.push({
      id: row.id,
      section: row.section,
      block: row.block,
      line: row.line,
      about: row.about,
      text: row.body,
      quote: row.quote,
      unsentRefs: row.unsent_refs,
      facts: row.facts,
      edit: row.edit_id
        ? { id: row.edit_id, text: row.edit_body!, included: row.edit_included! }
        : null,
    });
  }
  return [...drafts.values()];
}

/** The latest draft of each kind for a job text, resume first. */
export async function latestDrafts(pool: Pool, snapshotId: string): Promise<StoredDraft[]> {
  const { rows } = await pool.query<{ id: string }>(
    `select distinct on (kind) id from artifact where job_snapshot_id = $1
     order by kind, created_at desc, id`,
    [snapshotId],
  );
  return loadStored(
    pool,
    rows.map((row) => row.id),
  );
}

export async function loadDraft(
  pool: Pool,
  id: string,
  facts: FactState,
): Promise<Draft | undefined> {
  return (await loadDraftState(pool, id, facts))?.draft;
}

/** A draft as stored, and checked against the facts as they are now. */
export async function loadDraftState(
  pool: Pool,
  id: string,
  facts: FactState,
): Promise<{ stored: StoredDraft; draft: Draft } | undefined> {
  const [stored] = await loadStored(pool, [id]);
  return stored && { stored, draft: checkDraft(stored, facts) };
}

/** A stored draft with every statement checked against the facts as they are now. */
export function checkDraft(stored: StoredDraft, facts: FactState): Draft {
  const context = {
    jobText: stored.jobText,
    jobNames: [stored.title, stored.company ?? ''].join('\n'),
    vocabulary: vocabularyOf(
      stored.sentFacts.map((id) => facts.versions.get(id)!),
      stored.jobText,
    ),
  };
  return {
    id: stored.id,
    kind: stored.kind,
    jobId: stored.jobId,
    snapshotId: stored.snapshotId,
    title: stored.title,
    company: stored.company,
    createdAt: stored.createdAt.toISOString(),
    model: stored.model,
    costUsd: stored.costUsd,
    factsSent: stored.sentFacts.length,
    outdated: draftOutdated({
      sentFacts: stored.sentFacts,
      citableFacts: facts.citable.map((f) => f.versionId),
      newerText: stored.newerText,
    }),
    statements: stored.statements.map((s) => {
      const cited = s.facts.map((versionId): CitedFact => {
        const version = facts.versions.get(versionId)!;
        return {
          versionId,
          factId: version.factId,
          version: version.version,
          body: version.body,
          current: facts.usableInMaterials.has(versionId),
        };
      });
      const text = s.edit?.text ?? s.text;
      const included = s.edit?.included ?? true;
      const problems = statementProblems(
        {
          about: s.about,
          text,
          quote: s.quote,
          unsentRefs: s.unsentRefs,
          facts: cited.map((f) => ({ body: f.body, usable: f.current })),
        },
        context,
      );
      return {
        id: s.id,
        section: s.section,
        block: s.block,
        line: s.line,
        about: s.about,
        text,
        modelText: s.text,
        edited: text !== s.text,
        included,
        quote: s.quote,
        facts: cited,
        problems,
        inDocument: included && problems.length === 0,
        verbatim: s.about === 'me' && isVerbatim(text, cited),
      };
    }),
  };
}

export function summariseDraft(draft: Draft, pdfs: number): DraftSummary {
  return {
    id: draft.id,
    kind: draft.kind,
    createdAt: draft.createdAt,
    statements: draft.statements.length,
    rejected: draft.statements.filter((s) => s.problems.length > 0).length,
    outdated: draft.outdated,
    pdfs,
  };
}
