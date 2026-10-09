// Freezing an application (T09): what it was built from is recorded in the same statement that
// records the application, so the two cannot part. The job text is the application's own
// `job_snapshot_id`; these fragments add the rest. Nothing here is ever updated (triggers).

/** The match of the snapshot named by `snapshot` (an SQL expression) that is latest now. */
export const latestMatch = (snapshot: string) =>
  `(select m.id from match m where m.job_snapshot_id = ${snapshot}
    order by m.created_at desc, m.id desc limit 1)`;

/**
 * CTEs that keep the files named by the CTE `sent` (application_id, position, label, file_name,
 * document_pdf_id, body), the drafts the kept PDFs among them were printed from, and the fact
 * versions their statements cite. A statement's user version cites what DeepSeek's cited.
 */
export const freezeFiles = `
  files as (
    insert into application_file
      (application_id, position, label, file_name, document_pdf_id, body)
    select application_id, position, label, file_name, document_pdf_id, body from sent
  ),
  drafts as (
    insert into application_artifact (application_id, artifact_id)
    select distinct s.application_id, d.artifact_id
    from sent s join document_pdf d on d.id = s.document_pdf_id
  ),
  cited as (
    insert into application_fact_version (application_id, fact_version_id)
    select distinct s.application_id, f.fact_version_id
    from sent s
      join document_pdf_statement p on p.document_pdf_id = s.document_pdf_id
      join artifact_claim_fact f on f.artifact_claim_id = p.artifact_claim_id
  )`;
