import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AlertEmailsResponseSchema,
  ImportAlertEmailRequestSchema,
  ImportAlertEmailResponseSchema,
  maxAlertEmailLength,
  type AlertJob,
  type AlertJobMatch,
  type ImportAlertEmailResponse,
} from '@jsa/shared';
import type { Pool } from 'pg';
import { listedJobs } from '../discovery/same-job.ts';
import { httpError } from '../http-error.ts';
import { classifyEmail } from '../rules/alert-email.ts';
import { locationKey, sameJobKey, uniqueJobs } from '../rules/same-job.ts';
import { type AlertProvider, alertEntry, alertProviders } from './providers.ts';
import { type AlertMessage, parseMessage } from './message.ts';
import { type AlertEntry, readJobs } from './read.ts';

// Importing job-alert emails (T20). The pipeline is the same for every source: parse the email,
// find its source by the From address, check the sender's subject rules, read the jobs with the
// source's link and card rules, then record the email and its jobs. Nothing is requested from any
// site, and the email is untrusted text: it can only add job listings. Like every /api route,
// these need a session and a trusted Origin (app.ts).

export interface AlertRoutesOptions {
  pool: Pool;
}

// Room for the JSON escaping of the largest email source the app takes.
const bodyLimit = 3 * maxAlertEmailLength;

interface SourceRow {
  id: string;
  enabled: boolean;
}

interface JobChoice {
  jobId: string;
  match: AlertJobMatch;
  newJob: boolean;
}

/**
 * The job each entry belongs to, in the order of rules/same-job.ts: the same address or the same
 * site's id (`address`); the same company, title and location in this source's earlier emails,
 * or else the one job listed anywhere with the same company and title (`same_job`); otherwise a
 * new job. A new job counts for the entries after it, so one email listing a job twice adds it
 * once.
 */
async function chooseJobs(pool: Pool, sourceId: string | null, entries: AlertEntry[]) {
  const urls = entries.flatMap((e) => (e.url ? [e.url] : []));
  const { rows: byAddress } = await pool.query<{ url: string; job_id: string }>(
    `select distinct on (url) url, job_id from (
       select url, job_id, 0 as rank, first_seen_at as at from alert_job where source_id = $2
       union all select url, job_id, 1, first_saved_at from saved_job
       union all select url, job_id, 1, first_seen_at from job_posting
       union all select url, job_id, 2, first_seen_at from alert_job
     ) found where url = any($1)
     order by url, rank, at`,
    [urls, sourceId],
  );
  const addresses = new Map(byAddress.map((row) => [row.url, row.job_id]));
  const { rows: ownRows } = await pool.query<{
    job_id: string;
    external_id: string;
    company: string | null;
    title: string;
    location: string;
  }>('select job_id, external_id, company, title, location from alert_job where source_id = $1', [
    sourceId,
  ]);
  const ownIds = new Map(ownRows.map((row) => [row.external_id, row.job_id]));
  const ownKey = (e: { company: string | null; title: string; location: string }) => {
    const key = sameJobKey(e.company, e.title);
    return key && `${key}\u0000${locationKey(e.location)}`;
  };
  const own = uniqueJobs(ownRows.map((row) => ({ key: ownKey(row), jobId: row.job_id })));
  const listed = uniqueJobs(await listedJobs(pool));

  return entries.map((entry): JobChoice => {
    const known = (entry.url && addresses.get(entry.url)) || ownIds.get(entry.externalId);
    if (known) return { jobId: known, match: 'address', newJob: false };
    const sameHere = ownKey(entry) && own.get(ownKey(entry)!);
    if (sameHere) return { jobId: sameHere, match: 'same_job', newJob: false };
    const key = sameJobKey(entry.company, entry.title);
    const same = key && listed.get(key);
    if (same) return { jobId: same, match: 'same_job', newJob: false };
    const jobId = randomUUID();
    if (entry.url) addresses.set(entry.url, jobId);
    ownIds.set(entry.externalId, jobId);
    if (key && !listed.has(key)) listed.set(key, jobId);
    return { jobId, match: 'new', newJob: true };
  });
}

async function importEmail(pool: Pool, message: AlertMessage): Promise<ImportAlertEmailResponse> {
  const head = {
    sender: message.from,
    subject: message.subject,
    sentAt: message.sentAt?.toISOString() ?? null,
  };
  const skip = (catalogId: string | null, reason: string): ImportAlertEmailResponse => ({
    ...head,
    imported: false,
    reason,
    catalogId,
    again: false,
    jobs: [],
    unreadable: 0,
  });

  const found = classifyEmail(message, alertProviders);
  if ('unknown' in found) return skip(null, found.unknown);
  const provider: AlertProvider = found.source;
  if ('notAlert' in found) return skip(provider.id, found.notAlert);

  const { rows: sources } = await pool.query<SourceRow>(
    `select id, enabled from source where catalog_id = $1 and param = ''`,
    [provider.id],
  );
  const source = sources[0];
  const inUse = source ? source.enabled : alertEntry(provider).alert!.onByDefault;
  if (!inUse) {
    return skip(
      provider.id,
      `${provider.name} is turned off on the Sources page, so its emails are not imported.`,
    );
  }

  const read = readJobs(message, provider);
  if (!read.jobs.length && !found.sender.alertsOnly) {
    return skip(
      provider.id,
      `No job could be read from it, so it is not treated as a job alert from ${provider.name}.`,
    );
  }

  const choices = await chooseJobs(pool, source?.id ?? null, read.jobs);
  const input = read.jobs.map((entry, i) => ({
    url: entry.url,
    external_id: entry.externalId,
    title: entry.title,
    company: entry.company,
    location: entry.location,
    details: entry.details,
    job_id: choices[i]!.jobId,
    new_job: choices[i]!.newJob,
  }));
  const { rows } = await pool.query<{ again: boolean }>(
    `with src as (
       insert into source (catalog_id, last_success_at) values ($1, now())
       on conflict (catalog_id, param) do update set last_success_at = now()
       returning id
     ),
     email as (
       insert into alert_email (source_id, message_key, sender, subject, sent_at, jobs, unreadable)
       select id, $2, $3, $4, $5, $6, $7 from src
       on conflict (message_key) do update set
         jobs = excluded.jobs, unreadable = excluded.unreadable, last_imported_at = now()
       returning id, (xmax <> 0) as again
     ),
     input as (
       select * from jsonb_to_recordset($8::jsonb) as t(
         url text, external_id text, title text, company text, location text, details text,
         job_id uuid, new_job boolean)
     ),
     new_jobs as (insert into job (id) select job_id from input where new_job),
     listed as (
       insert into alert_job
         (source_id, job_id, url, external_id, title, company, location, details, alert_email_id)
       select src.id, i.job_id, i.url, i.external_id, i.title, i.company, i.location, i.details,
         email.id
       from input i, src, email
       where i.url is not null
       on conflict (source_id, url) do update set
         external_id = excluded.external_id, title = excluded.title, company = excluded.company,
         location = excluded.location, details = excluded.details,
         alert_email_id = excluded.alert_email_id, last_seen_at = now()
     ),
     -- Jobs read without a link, known by the hash of their company, title and location.
     unaddressed as (
       insert into alert_job
         (source_id, job_id, url, external_id, title, company, location, details, alert_email_id)
       select src.id, i.job_id, null, i.external_id, i.title, i.company, i.location, i.details,
         email.id
       from input i, src, email
       where i.url is null
       on conflict (source_id, external_id) where url is null do update set
         title = excluded.title, company = excluded.company, location = excluded.location,
         details = excluded.details, alert_email_id = excluded.alert_email_id, last_seen_at = now()
     )
     select again from email`,
    [
      provider.id,
      message.key,
      message.from.slice(0, 320),
      message.subject.slice(0, 1000),
      message.sentAt,
      read.jobs.length,
      read.unreadable,
      JSON.stringify(input),
    ],
  );

  // Jobs one of the user's job boards lists now, whose text the app can read there.
  const { rows: boards } = await pool.query<{ job_id: string }>(
    `select distinct p.job_id from job_posting p join source s on s.id = p.source_id
     where p.job_id = any($1) and p.closed_at is null and s.enabled`,
    [choices.map((c) => c.jobId)],
  );
  const onBoard = new Set(boards.map((row) => row.job_id));
  const jobs: AlertJob[] = read.jobs.map((entry, i) => ({
    jobId: choices[i]!.jobId,
    title: entry.title,
    company: entry.company,
    location: entry.location,
    url: entry.url,
    match: choices[i]!.match,
    onBoard: onBoard.has(choices[i]!.jobId),
  }));
  return {
    ...head,
    imported: true,
    reason: jobs.length
      ? ''
      : `No job could be read from this ${provider.name} email. The app may not know its layout yet.`,
    catalogId: provider.id,
    again: rows[0]!.again,
    jobs,
    unreadable: read.unreadable,
  };
}

export const alertRoutes: FastifyPluginAsyncTypebox<AlertRoutesOptions> = async (app, { pool }) => {
  // One import at a time, so two imports of emails listing the same job cannot both add it.
  let importing = false;

  app.post(
    '/alert-emails',
    {
      bodyLimit,
      schema: {
        body: ImportAlertEmailRequestSchema,
        response: { 200: ImportAlertEmailResponseSchema },
      },
    },
    async (request) => {
      const message = await parseMessage(request.body.message);
      if ('error' in message) throw httpError(400, message.error);
      if (importing) throw httpError(409, 'Another email is being imported. Try again.');
      importing = true;
      try {
        return await importEmail(pool, message);
      } finally {
        importing = false;
      }
    },
  );

  app.get(
    '/alert-emails',
    { schema: { response: { 200: AlertEmailsResponseSchema } } },
    async () => {
      const { rows } = await pool.query<{
        id: string;
        catalog_id: string;
        subject: string;
        sent_at: Date | null;
        jobs: number;
        unreadable: number;
        last_imported_at: Date;
      }>(
        `select e.id, s.catalog_id, e.subject, e.sent_at, e.jobs, e.unreadable, e.last_imported_at
         from alert_email e join source s on s.id = e.source_id
         order by e.last_imported_at desc, e.id
         limit 20`,
      );
      return {
        emails: rows.map((row) => ({
          id: row.id,
          catalogId: row.catalog_id,
          subject: row.subject,
          sentAt: row.sent_at?.toISOString() ?? null,
          jobs: row.jobs,
          unreadable: row.unreadable,
          lastImportedAt: row.last_imported_at.toISOString(),
        })),
      };
    },
  );
};
