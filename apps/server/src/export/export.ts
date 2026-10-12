import { createHash } from 'node:crypto';
import type { ApplicationStatus, FactKind } from '@jsa/shared';
import type { Pool, PoolClient } from 'pg';
import { applicationsMarkdown, type ExportedApplication, factsMarkdown } from './markdown.ts';
import { type ZipEntry, zip } from './zip.ts';

/** Bumped whenever the layout of the archive or of data.json changes in a way readers notice. */
export const exportFormatVersion = 1;

// Sign-in data and credentials never leave the database: Better Auth's tables (password hash,
// sessions) and the runner tokens' fingerprints. The migrations table says nothing about the user.
const leftOut = ['user', 'session', 'account', 'verification', 'runner_token', 'pgmigrations'];

const readme = `# Job Search Workbench export

- \`facts.md\`: the current, confirmed version of each fact, as Markdown the Facts page imports.
- \`applications.md\`: every application, with links to the files that went out.
- \`data.json\`: every table of the app's database as JSON (rows in key order), except sign-in
  data and runner tokens. A file column holds \`{ "file": <path in this archive>, "bytes": <size> }\`.
- \`files/<table>/<key>.<pdf|png|bin>\`: the stored files themselves: kept and sent PDFs,
  the runner's screenshots.
- \`manifest.json\`: the format version, the newest database migration, and the size and
  SHA-256 of every other file here.

This is a copy to read and keep. It contains private job-search data; store it somewhere private.
Confirmed facts can be imported again on the Facts page. This archive is not a database restore file.
`;

interface TableInfo {
  table: string;
  key: string[];
  files: string[];
}

/** The whole export as one zip, read in one snapshot so that its parts agree. */
// shortcut: the archive is built in memory, stream it when attachments approach the server's memory budget.
export async function exportArchive(pool: Pool, now = new Date()): Promise<Buffer> {
  const client = await pool.connect();
  // A checked-out client has no error listener of the pool's (see CLAUDE.md).
  const onError = () => {};
  client.on('error', onError);
  try {
    await client.query('begin isolation level repeatable read read only');
    const entries = await exportEntries(client, now);
    await client.query('commit');
    return zip(entries, now);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.off('error', onError);
    client.release();
  }
}

async function exportEntries(client: PoolClient, now: Date): Promise<ZipEntry[]> {
  const files = new Map<string, ZipEntry>(); // `<table>/<key>` → file entry
  const data: Record<string, unknown[]> = {};

  for (const t of await tables(client)) {
    const order = t.key.length
      ? t.key.map((c) => client.escapeIdentifier(c)).join(', ')
      : 't::text';
    const { rows } = await client.query<Record<string, unknown>>(
      `select t.* from ${client.escapeIdentifier(t.table)} t order by ${order}`,
    );
    data[t.table] = rows.map((row, i) => {
      const key = t.key.length ? t.key.map((c) => String(row[c])).join('_') : String(i);
      for (const column of t.files) {
        const body = row[column];
        if (!(body instanceof Buffer)) continue;
        const name = t.files.length > 1 ? `${key}-${column}` : key;
        const path = `files/${t.table}/${name}.${extensionOf(body)}`;
        files.set(`${t.table}/${name}`, { name: path, data: body });
        row[column] = { file: path, bytes: body.length };
      }
      return row;
    });
  }

  const migration = await client.query<{ name: string }>(
    'select name from pgmigrations order by run_on desc, id desc limit 1',
  );
  const entries: ZipEntry[] = [
    { name: 'README.md', data: Buffer.from(readme) },
    { name: 'facts.md', data: Buffer.from(factsMarkdown(await facts(client), now)) },
    {
      name: 'applications.md',
      data: Buffer.from(applicationsMarkdown(await applications(client, files), now)),
    },
    { name: 'data.json', data: Buffer.from(`${JSON.stringify(data, null, 2)}\n`) },
    ...files.values(),
  ];
  const manifest = {
    format: 'job-search-workbench-export',
    version: exportFormatVersion,
    exportedAt: now.toISOString(),
    migration: migration.rows[0]?.name ?? null,
    files: entries.map((e) => ({
      path: e.name,
      bytes: e.data.length,
      sha256: createHash('sha256').update(e.data).digest('hex'),
    })),
  };
  return [
    ...entries,
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
  ];
}

async function tables(client: PoolClient): Promise<TableInfo[]> {
  const { rows } = await client.query<TableInfo>(
    `select c.relname as table,
       array(select a.attname from pg_index i
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
             where i.indrelid = c.oid and i.indisprimary
             order by array_position(i.indkey::int2[], a.attnum))::text[] as key,
       array(select a.attname from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
               and a.atttypid = 'bytea'::regtype
             order by a.attnum)::text[] as files
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> all ($1)
     order by c.relname`,
    [leftOut],
  );
  return rows;
}

function extensionOf(body: Buffer) {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  return 'bin';
}

async function facts(client: PoolClient) {
  const { rows } = await client.query<{ kind: FactKind; body: string }>(
    `select f.kind, v.body
     from fact f
     join lateral (select * from fact_version where fact_id = f.id order by version desc limit 1) v
       on true
     where v.status = 'confirmed'
     order by f.created_at, f.id`,
  );
  return rows;
}

async function applications(
  client: PoolClient,
  files: Map<string, ZipEntry>,
): Promise<ExportedApplication[]> {
  const { rows } = await client.query<{
    id: string;
    title: string;
    company: string;
    source_url: string | null;
    status: ApplicationStatus;
    method: 'runner' | 'manual';
    submitted_at: Date | null;
    created_at: Date;
    note: string;
    files: {
      id: string;
      label: string;
      file_name: string;
      document_pdf_id: string | null;
      body_sha256: string;
    }[];
  }>(
    `select a.id, s.title, coalesce(s.company, '') as company, s.source_url, a.status, a.method, a.submitted_at,
       a.created_at, a.note,
       coalesce((select json_agg(json_build_object('id', f.id, 'label', f.label,
                  'file_name', f.file_name, 'document_pdf_id', f.document_pdf_id,
                  'body_sha256', f.body_sha256) order by f.position)
                 from application_file f where f.application_id = a.id), '[]') as files
     from application a join job_snapshot s on s.id = a.job_snapshot_id
     order by coalesce(a.submitted_at, a.created_at), a.id`,
  );
  return rows.map((a) => ({
    title: a.title,
    company: a.company,
    sourceUrl: a.source_url,
    status: a.status,
    method: a.method,
    submittedAt: a.submitted_at,
    createdAt: a.created_at,
    note: a.note,
    files: a.files.map((f) => ({
      label: f.label,
      fileName: f.file_name,
      path: files.get(
        f.document_pdf_id ? `document_pdf/${f.document_pdf_id}` : `application_file/${f.id}`,
      )!.name,
      sha256: f.body_sha256,
    })),
  }));
}
