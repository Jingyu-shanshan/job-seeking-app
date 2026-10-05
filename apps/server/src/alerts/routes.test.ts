import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  AlertEmailsResponse,
  DiscoveryRun,
  ImportAlertEmailResponse,
  JobDetail,
  JobsResponse,
  SavePageResponse,
  SourcesResponse,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { linkedInAlert, linkedInCard, mandrillLink, testEmail } from '../testing/email.ts';
import { fakeGreenhouse } from '../testing/greenhouse.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'owner', password: 'correct horse battery' };

// Made-up companies, jobs and LinkedIn job ids.
const linkedInJob = (id: number) => `https://www.linkedin.com/jobs/view/${id}/`;
const alert = (cards: Parameters<typeof linkedInCard>[0][], fields = {}) =>
  testEmail({
    from: 'jobalerts-noreply@linkedin.com',
    subject: '“engineer”: new jobs for you',
    html: linkedInAlert(cards.map(linkedInCard)),
    ...fields,
  });

describe('importing job-alert emails', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const boards: Parameters<typeof fakeGreenhouse>[0] = {};
  const greenhouse = fakeGreenhouse(boards);

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: greenhouse.fetch,
    });
    await createAccount({ pool, secret, appUrl, trustedOrigins }, account);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: account.email, password: account.password },
    });
    const setCookie = [signIn.headers['set-cookie'] ?? []].flat();
    cookie = setCookie.find((c) => c.startsWith('better-auth.session_token='))!.split(';', 1)[0]!;
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  const call = (options: InjectOptions) =>
    app.inject({ ...options, headers: { cookie, origin: appUrl, ...options.headers } });

  const importEmail = async (message: string) => {
    const res = await call({ method: 'POST', url: '/api/alert-emails', payload: { message } });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<ImportAlertEmailResponse>();
  };
  const jobs = async () =>
    (await call({ method: 'GET', url: '/api/jobs' })).json<JobsResponse>().jobs;
  const jobCount = async () =>
    (await pool.query<{ n: number }>('select count(*)::int as n from job')).rows[0]!.n;
  const detail = async (id: string) =>
    (await call({ method: 'GET', url: `/api/jobs/${id}` })).json<JobDetail>();
  const sources = async () =>
    (await call({ method: 'GET', url: '/api/sources' })).json<SourcesResponse>();

  test('needs a session and a trusted Origin, and an email’s full source', async () => {
    const message = alert([]);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/alert-emails',
      headers: { origin: appUrl },
      payload: { message },
    });
    assert.equal(anonymous.statusCode, 401);
    const crossSite = await call({
      method: 'POST',
      url: '/api/alert-emails',
      headers: { origin: 'https://evil.example.com' },
      payload: { message },
    });
    assert.equal(crossSite.statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/alert-emails' })).statusCode, 401);

    const notEmail = await call({
      method: 'POST',
      url: '/api/alert-emails',
      payload: { message: 'Backend Engineer at Acme, Helsinki' },
    });
    assert.equal(notEmail.statusCode, 400);
    assert.match(notEmail.json<{ message: string }>().message, /Show original/);
  });

  test('reads the jobs, lists them as needing their text, and makes no request', async () => {
    const before = greenhouse.requested.length;
    const result = await importEmail(
      alert([
        {
          id: 4200000001,
          title: 'Backend Engineer',
          company: 'Acme Oy',
          location: 'Helsinki, Uusimaa, Finland (Hybrid)',
        },
        {
          id: 4200000002,
          title: 'Frontend Engineer',
          company: 'Beta Oy',
          location: 'Espoo, Finland',
        },
      ]),
    );
    assert.equal(result.imported, true);
    assert.equal(result.catalogId, 'linkedin_alert');
    assert.equal(result.again, false);
    assert.equal(result.sentAt, '2026-10-02T07:12:00.000Z');
    assert.deepEqual(
      result.jobs.map((j) => [j.title, j.company, j.url, j.match, j.onBoard]),
      [
        ['Backend Engineer', 'Acme Oy', linkedInJob(4200000001), 'new', false],
        ['Frontend Engineer', 'Beta Oy', linkedInJob(4200000002), 'new', false],
      ],
    );
    assert.equal(greenhouse.requested.length, before);

    const listed = (await jobs()).filter((j) => j.origin === 'alert');
    assert.deepEqual(
      listed.map((j) => [j.title, j.needsText, j.alerts, j.verdict]),
      [
        ['Backend Engineer', true, ['LinkedIn'], 'eligible'],
        ['Frontend Engineer', true, ['LinkedIn'], 'eligible'],
      ],
    );

    // No text: nothing to summarise or match, and no source to read it from.
    const job = await detail(result.jobs[0]!.jobId);
    assert.equal(job.snapshot, null);
    assert.equal(job.canImport, false);
    assert.deepEqual(
      job.alerts.map((a) => [a.catalogId, a.subject, a.url]),
      [['linkedin_alert', '“engineer”: new jobs for you', linkedInJob(4200000001)]],
    );
    const read = await call({ method: 'POST', url: `/api/jobs/${job.id}/snapshots` });
    assert.equal(read.statusCode, 409);
    assert.equal(greenhouse.requested.length, before);

    // The source is in use now, with its email counted.
    const { sources: rows, alerts } = await sources();
    const source = rows.find((s) => s.catalogId === 'linkedin_alert');
    assert.equal(source?.enabled, true);
    assert.ok(source?.lastSuccessAt);
    assert.deepEqual(alerts, [
      {
        catalogId: 'linkedin_alert',
        emails: 1,
        lastSentAt: '2026-10-02T07:12:00.000Z',
        lastHadNoJobs: false,
      },
    ]);

    // Nothing from the email's links or the recipient is stored.
    const { rows: stored } = await pool.query<{ row: string }>(
      `select row_to_json(e)::text as row from alert_email e
       union all select row_to_json(a)::text from alert_job a`,
    );
    for (const { row } of stored) {
      assert.doesNotMatch(row, /otpToken|trackingId|person@example\.com/);
    }
  });

  test('a job behind a click tracker is stored at its own address, and the tracker is not visited', async () => {
    const before = greenhouse.requested.length;
    const link = mandrillLink(
      'https://duunitori.fi/tyopaikat/tyo/frontend-developer-scsom-18100001?utm_source=jobsfinland&utm_medium=email',
    );
    const result = await importEmail(
      testEmail({
        from: 'duunivahti@duunitori.fi',
        subject: 'Duunitori found 1 job in Finland for you - View the newest opportunities',
        html: `<p>Here are 1 new jobs that we found by your jobwatch</p><p>Omega Oy</p><h2>Frontend Developer</h2>
          <p>We make maps.</p><p><a href="${link}">Read more</a></p>`,
      }),
    );
    assert.deepEqual(
      result.jobs.map((j) => [j.title, j.company, j.url, j.match]),
      [
        [
          'Frontend Developer',
          'Omega Oy',
          'https://duunitori.fi/tyopaikat/tyo/frontend-developer-scsom-18100001',
          'new',
        ],
      ],
    );
    assert.equal(greenhouse.requested.length, before);
    const { rows } = await pool.query<{ row: string }>(
      `select row_to_json(a)::text as row from alert_job a where a.external_id = '18100001'`,
    );
    assert.doesNotMatch(rows[0]!.row, /mandrillapp|utm_/);
  });

  test('importing the same email again, pasted or uploaded, adds no job', async () => {
    const message = alert(
      [{ id: 4200000003, title: 'Data Engineer', company: 'Gamma Oy', location: 'Helsinki' }],
      { messageId: 'same-email@mail.example.com' },
    );
    const first = await importEmail(message);
    const count = await jobCount();
    const second = await importEmail(message.replaceAll('\r\n', '\n'));
    assert.equal(second.again, true);
    assert.deepEqual(
      second.jobs.map((j) => [j.jobId, j.match]),
      [[first.jobs[0]!.jobId, 'address']],
    );
    assert.equal(await jobCount(), count);

    // Without a Message-ID, the content identifies the email.
    const noId = alert(
      [{ id: 4200000004, title: 'ML Engineer', company: 'Gamma Oy', location: 'Helsinki' }],
      { messageId: null },
    );
    assert.equal((await importEmail(noId)).again, false);
    assert.equal((await importEmail(noId.replaceAll('\r\n', '\n') + '\n\n')).again, true);
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from alert_email where message_key like 'sha256:%'`,
    );
    assert.equal(rows[0]!.n, 1);

    // Another email listing a job the app has: the same job.
    const other = await importEmail(
      alert([
        { id: 4200000003, title: 'Data Engineer', company: 'Gamma Oy', location: 'Helsinki' },
      ]),
    );
    assert.deepEqual(
      other.jobs.map((j) => [j.jobId, j.match]),
      [[first.jobs[0]!.jobId, 'address']],
    );
    assert.equal(await jobCount(), count + 1);
  });

  test('mail that is not a job alert is not imported', async () => {
    const count = await jobCount();
    const emails = async () =>
      (await pool.query<{ n: number }>('select count(*)::int as n from alert_email')).rows[0]!.n;
    const stored = await emails();
    const card = [{ id: 4200000010, title: 'Engineer', company: 'Acme', location: 'Helsinki' }];

    const unknown = await importEmail(alert(card, { from: 'info@glassdoor.com' }));
    assert.equal(unknown.imported, false);
    assert.equal(unknown.catalogId, null);
    assert.match(unknown.reason, /info@glassdoor\.com, which is not a job-alert sender/);

    const update = await importEmail(
      alert(card, {
        from: 'jobs-noreply@linkedin.com',
        subject: 'Your application was sent to Acme',
      }),
    );
    assert.equal(update.imported, false);
    assert.equal(update.catalogId, 'linkedin_alert');
    assert.match(update.reason, /not a job alert from LinkedIn/);

    // A sender that also sends marketing: an email with no job is not an alert.
    const marketing = await importEmail(
      testEmail({
        from: 'no-reply@notifications.snaphunt.com',
        subject: 'Supercharge your job search!',
        html: '<p>Upgrade now. <a href="https://snaphunt.com/pricing">See plans</a></p>',
      }),
    );
    assert.equal(marketing.imported, false);
    assert.match(marketing.reason, /No job could be read/);

    assert.equal(await jobCount(), count);
    assert.equal(await emails(), stored);
    assert.ok(!(await sources()).sources.some((s) => s.catalogId === 'snaphunt_alert'));
  });

  test('an alert from a sender of only alerts with no readable job is kept for review', async () => {
    const duunitori = async () =>
      (await sources()).alerts.find((a) => a.catalogId === 'duunitori_alert');
    const before = (await duunitori())?.emails ?? 0;
    const result = await importEmail(
      testEmail({
        from: 'duunivahti@duunitori.fi',
        subject: 'Duunitori found 2 jobs in Finland for you - View the newest opportunities',
        html: '<p>A layout the app cannot read. <a href="https://duunitori.fi/x/opaque">Open</a></p>',
      }),
    );
    assert.equal(result.imported, true);
    assert.deepEqual(result.jobs, []);
    assert.match(result.reason, /may not know its layout/);
    const stats = await duunitori();
    assert.equal(stats?.lastHadNoJobs, true);
    assert.equal(stats?.emails, before + 1);
  });

  test('a source turned off imports nothing and hides its jobs; recruiter messages start off', async () => {
    const linkedIn = (await sources()).sources.find((s) => s.catalogId === 'linkedin_alert')!;
    const off = await call({
      method: 'PATCH',
      url: `/api/sources/${linkedIn.id}`,
      payload: { enabled: false },
    });
    assert.equal(off.statusCode, 200);
    const skipped = await importEmail(
      alert([{ id: 4200000020, title: 'Hidden Engineer', company: 'Acme', location: 'Helsinki' }]),
    );
    assert.equal(skipped.imported, false);
    assert.match(skipped.reason, /LinkedIn is turned off/);
    assert.ok(!(await jobs()).some((j) => j.alerts.includes('LinkedIn')));
    await call({ method: 'PATCH', url: `/api/sources/${linkedIn.id}`, payload: { enabled: true } });
    assert.ok((await jobs()).some((j) => j.title === 'Backend Engineer'));

    const recruiter = testEmail({
      from: 'conversations@message.teamtailor.com',
      subject: 'Senior Backend Developer at Example Club',
      html: '<p>Hi! Have a look: <a href="https://careers.example.org/jobs/5550001-senior-backend-developer">Senior Backend Developer</a></p><p>Helsinki</p>',
    });
    const first = await importEmail(recruiter);
    assert.equal(first.imported, false);
    assert.match(first.reason, /Recruiter opportunities is turned off/);
    // A source that is on by default can be turned off before any import, and the other way round.
    const added = await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'teamtailor_recruiter', enabled: true },
    });
    assert.equal(added.statusCode, 201);
    const second = await importEmail(recruiter);
    assert.equal(second.imported, true);
    assert.deepEqual(
      second.jobs.map((j) => [j.title, j.company, j.location, j.url]),
      [
        [
          'Senior Backend Developer',
          'Example Club',
          'Helsinki',
          'https://careers.example.org/jobs/5550001',
        ],
      ],
    );
    const glassdoorOff = await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'glassdoor_alert', enabled: false },
    });
    assert.equal(glassdoorOff.json<{ enabled: boolean }>().enabled, false);
  });

  test('a job a job board lists, with the same company and title, is that job', async () => {
    boards['delta'] = [
      { id: 71, title: 'Platform Engineer', company_name: 'Delta', location: 'Helsinki, Finland' },
      { id: 72, title: 'Software Engineer', company_name: 'Delta', location: 'Helsinki, Finland' },
      { id: 73, title: 'Software Engineer', company_name: 'Delta', location: 'Oulu, Finland' },
    ];
    await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'delta' },
    });
    await call({ method: 'POST', url: '/api/discovery-runs', payload: {} });
    const boardJob = (await jobs()).find((j) => j.title === 'Platform Engineer')!;

    const result = await importEmail(
      alert([
        {
          id: 4200000030,
          title: 'Platform Engineer',
          company: 'Delta Oy',
          location: 'Helsinki, Uusimaa, Finland',
        },
        {
          id: 4200000031,
          title: 'Software Engineer',
          company: 'Delta Oy',
          location: 'Helsinki, Uusimaa, Finland',
        },
      ]),
    );
    assert.deepEqual(
      result.jobs.map((j) => [j.title, j.match, j.onBoard, j.jobId === boardJob.id]),
      [
        ['Platform Engineer', 'same_job', true, true],
        // Two board jobs have this title: neither is assumed.
        ['Software Engineer', 'new', false, false],
      ],
    );

    // Listed once, as the board's job, and its text can be read from the board.
    const listed = (await jobs()).filter((j) => j.title === 'Platform Engineer');
    assert.deepEqual(
      listed.map((j) => [j.origin, j.needsText, j.alerts, j.sources.length]),
      [['discovered', false, ['LinkedIn'], 1]],
    );
    const job = await detail(boardJob.id);
    assert.equal(job.canImport, true);
    assert.equal(job.alerts.length, 1);
  });

  test('a board job found after the alert, with the same company and title, joins it', async () => {
    const result = await importEmail(
      alert([
        {
          id: 4200000040,
          title: 'Site Reliability Engineer',
          company: 'Epsilon Oy',
          location: 'Helsinki',
        },
      ]),
    );
    const alertJob = result.jobs[0]!.jobId;
    boards['epsilon'] = [
      {
        id: 81,
        title: 'Site Reliability Engineer',
        company_name: 'Epsilon',
        location: 'Helsinki, Finland',
      },
    ];
    await call({
      method: 'POST',
      url: '/api/sources',
      payload: { catalogId: 'greenhouse_board', param: 'epsilon' },
    });
    const run = (
      await call({ method: 'POST', url: '/api/discovery-runs', payload: {} })
    ).json<DiscoveryRun>();
    assert.equal(run.sources.find((s) => s.param === 'epsilon')?.added, 0);
    const listed = (await jobs()).filter((j) => j.title === 'Site Reliability Engineer');
    assert.deepEqual(
      listed.map((j) => [j.id, j.origin, j.needsText]),
      [[alertJob, 'discovered', false]],
    );
  });

  test('the same job in alerts of two sites, or saved in the desktop app, is one job', async () => {
    const first = await importEmail(
      alert([
        { id: 4200000050, title: 'Full-Stack Developer', company: 'Zeta Oy', location: 'Helsinki' },
      ]),
    );
    const jobId = first.jobs[0]!.jobId;

    // Teamtailor's alert of the same company names it in the subject.
    const teamtailor = await importEmail(
      testEmail({
        from: 'no-reply@zeta.teamtailor-mail.com',
        subject: 'Zeta: one new job matching your profile',
        html: '<p><a href="https://zeta.teamtailor.com/jobs/900001-fullstack-developer">Fullstack Developer</a></p><p>Helsinki</p>',
      }),
    );
    assert.deepEqual(
      teamtailor.jobs.map((j) => [j.jobId, j.match]),
      [[jobId, 'same_job']],
    );

    // Saving the LinkedIn page of the job in the desktop app.
    const saved = await call({
      method: 'POST',
      url: '/api/saved-pages',
      payload: {
        url: `${linkedInJob(4200000050)}?refId=x`,
        title: 'Full-Stack Developer',
        company: 'Zeta Oy',
        location: 'Helsinki',
        text: 'Full-Stack Developer\n\nYou will build our web app.',
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      [saved.json<SavePageResponse>().jobId, saved.json<SavePageResponse>().newJob],
      [jobId, false],
    );
    const listed = (await jobs()).filter((j) => j.id === jobId);
    assert.deepEqual(
      listed.map((j) => [j.origin, j.needsText, j.alerts]),
      [['saved', false, ['LinkedIn', 'Teamtailor companies']]],
    );

    // A results-page entry on another site with the same company and title.
    const results = await call({
      method: 'POST',
      url: '/api/saved-results',
      payload: {
        entries: [
          {
            url: 'https://jobs.example.net/zeta/123',
            title: 'Full Stack Developer',
            company: 'ZETA',
          },
        ],
      },
    });
    assert.deepEqual(results.json(), { saved: 1, newJobs: 0 });
  });

  test('a job an email names without a readable link is imported without an address', async () => {
    const snaphunt = (subject: string) =>
      testEmail({
        from: 'no-reply@notifications.snaphunt.com',
        subject,
        html: `<p>You have a new job matching your profile.</p><h2>Odoo Consultant</h2><p>Theta Partners</p>
          <p>REMOTE | Europe/Berlin</p><p>Great Work Culture</p>
          <p><a href="https://u1000001.ct.sendgrid.net/ls/click?upn=u001.EncryptedPayloadAbCdEfGh-2FIj-3D">View job</a></p>`,
      });
    const before = greenhouse.requested.length;
    const first = await importEmail(snaphunt('Matching job: Odoo Consultant at Theta Partners'));
    assert.deepEqual(
      first.jobs.map((j) => [j.title, j.company, j.location, j.url, j.match]),
      [['Odoo Consultant', 'Theta Partners', 'REMOTE | Europe/Berlin', null, 'new']],
    );
    const jobId = first.jobs[0]!.jobId;
    // Another email with the same job refreshes the same row.
    const second = await importEmail(snaphunt('Matching job: Odoo Consultant at Theta Partners'));
    assert.deepEqual(
      second.jobs.map((j) => [j.jobId, j.match]),
      [[jobId, 'address']],
    );
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from alert_job where job_id = $1 and url is null`,
      [jobId],
    );
    assert.equal(rows[0]!.n, 1);
    assert.equal(greenhouse.requested.length, before);

    const listed = (await jobs()).find((j) => j.id === jobId)!;
    assert.deepEqual([listed.url, listed.needsText, listed.alerts], [null, true, ['Snaphunt']]);
    const job = await detail(jobId);
    assert.deepEqual([job.url, job.alerts[0]!.url, job.snapshot], [null, null, null]);

    // Its text needs the link it came from, which then becomes its address.
    const text = 'Odoo Consultant\n\nYou will set up Odoo for our clients.';
    const noLink = await call({
      method: 'POST',
      url: `/api/jobs/${jobId}/text`,
      payload: { text },
    });
    assert.equal(noLink.statusCode, 400);
    assert.match(noLink.json<{ message: string }>().message, /no link to this job/);
    const pasted = await call({
      method: 'POST',
      url: `/api/jobs/${jobId}/text`,
      payload: { text, url: 'https://snaphunt.com/job/EXAMPLE1' },
    });
    assert.equal(pasted.statusCode, 200, pasted.body);
    assert.equal(pasted.json<JobDetail>().url, 'https://snaphunt.com/job/EXAMPLE1');
    assert.equal(pasted.json<JobDetail>().snapshot?.url, 'https://snaphunt.com/job/EXAMPLE1');
    assert.equal(
      (await jobs()).find((j) => j.id === jobId)!.url,
      'https://snaphunt.com/job/EXAMPLE1',
    );
  });

  test('lists the emails imported last', async () => {
    const { emails } = (
      await call({ method: 'GET', url: '/api/alert-emails' })
    ).json<AlertEmailsResponse>();
    assert.ok(emails.length >= 5);
    assert.deepEqual(Object.keys(emails[0]!).sort(), [
      'catalogId',
      'id',
      'jobs',
      'lastImportedAt',
      'sentAt',
      'subject',
      'unreadable',
    ]);
    const sorted = [...emails].sort((a, b) => b.lastImportedAt.localeCompare(a.lastImportedAt));
    assert.deepEqual(emails, sorted);
  });
});
