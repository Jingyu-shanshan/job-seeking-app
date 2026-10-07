import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type {
  Draft,
  DraftDocument,
  DraftStatement,
  Fact,
  JobDetail,
  PdfCheck,
  Profile,
} from '@jsa/shared';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app.ts';
import { createAccount } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { resumeSystemPrompt } from '../drafts/write.ts';
import { documentPieces } from '../rules/document.ts';
import { createTestDatabase, needsDatabase, type TestDatabase } from '../testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
import { pdfOf } from '../testing/pdf.ts';

const { appUrl, trustedOrigins } = loadConfig({});
const secret = 'test-secret-that-is-at-least-32-characters';
const account = { email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' };
const uuid = '00000000-0000-4000-8000-000000000000';

const jobText = `Payments Engineer, Example Pay

You will build the APIs that move money for 40,000 merchants.

What you bring
- 3+ years of Go`;

const facts = {
  role: 'Backend developer at Acme Oy, 2021-03 – 2024-06',
  result: 'Built the invoice API in Go; cut processing time by about 30%',
  skills: 'Go, PostgreSQL, Kafka',
};

interface SentDraft {
  facts: { ref: string; text: string }[];
}

const ref = (sent: SentDraft, words: string) =>
  sent.facts.find((f) => f.text.includes(words))?.ref ?? 'F404';

const resume = (sent: SentDraft) => ({
  headline: { text: 'Backend developer', facts: [ref(sent, 'Acme')] },
  summary: [{ text: 'Cut processing time by 45%.', facts: [ref(sent, 'invoice')] }],
  experience: [
    {
      title: { text: 'Backend developer, Acme Oy, 2021-03 – 2024-06', facts: [ref(sent, 'Acme')] },
      bullets: [
        { text: facts.result, facts: [ref(sent, 'invoice')] },
        { text: 'Led the platform team.', facts: [] },
      ],
    },
  ],
  skills: [{ title: { text: facts.skills, facts: [ref(sent, 'Kafka')] }, bullets: [] }],
});

const coverLetter = (sent: SentDraft) => ({
  paragraphs: [
    [
      { about: 'other', text: 'I am applying for the Payments Engineer role at Example Pay.' },
      {
        about: 'job',
        text: 'You are building the APIs that move money for 40,000 merchants.',
        quote: 'You will build the APIs that move money for 40,000 merchants.',
      },
    ],
    [
      {
        about: 'me',
        text: 'At Acme Oy I built the invoice API in Go and cut its processing time by about 30%.',
        facts: [ref(sent, 'Acme'), ref(sent, 'invoice')],
      },
    ],
  ],
});

/** Lines of at most `width` characters, broken at spaces, as a PDF wraps them. */
function wrapped(pieces: readonly string[], width = 70): string[] {
  return pieces.flatMap((piece) => {
    const lines: string[] = [];
    let line = '';
    for (const word of piece.split(' ')) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    return [...lines, line];
  });
}

describe('review and PDF', needsDatabase, () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const deepseek = fakeDeepSeek(async () => {
    const sent = deepseek.requests.at(-1)!;
    const write = sent.body.messages[0]!.content === resumeSystemPrompt ? resume : coverLetter;
    return chatCompletion(JSON.stringify(write(JSON.parse(sent.body.messages[1]!.content))));
  });

  before(async () => {
    db = await createTestDatabase();
    pool = new Pool({ connectionString: db.url });
    app = buildApp({
      webRoot: join(tmpdir(), 'jsa-web-does-not-exist'),
      databaseUrl: db.url,
      authSecret: secret,
      appUrl,
      trustedOrigins,
      fetch: deepseek.fetch,
      deepseekApiKey: 'sk-test',
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

  const ok = async <T>(options: InjectOptions, status = 200) => {
    const res = await call(options);
    assert.equal(res.statusCode, status, res.body);
    return res.json<T>();
  };

  const count = async (from: string, values: unknown[] = []) =>
    Number((await pool.query(`select count(*) from ${from}`, values)).rows[0].count);

  const edit = (
    draftId: string,
    s: DraftStatement,
    change: Partial<Record<'text', string>> & { included?: boolean },
  ) =>
    call({
      method: 'PUT',
      url: `/api/drafts/${draftId}/statements/${s.id}`,
      payload: { text: change.text ?? s.text, included: change.included ?? s.included },
    });

  const upload = (draftId: string, body: Buffer, headers: Record<string, string> = {}) =>
    call({
      method: 'POST',
      url: `/api/drafts/${draftId}/pdfs`,
      payload: body,
      headers: { 'content-type': 'application/pdf', ...headers },
    });

  const documentOf = (draftId: string) =>
    ok<DraftDocument>({ method: 'GET', url: `/api/drafts/${draftId}/document` });

  let job: JobDetail;
  let resumeDraft: Draft;
  let letter: Draft;
  let result: Fact;

  test('your details: empty at first, saved tidy, and refused when they cannot be right', async () => {
    const empty: Profile = { name: '', email: '', phone: '', location: '', links: [] };
    assert.deepEqual(await ok<Profile>({ method: 'GET', url: '/api/profile' }), empty);

    const saved = await ok<Profile>({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        name: '  Test   Person ',
        email: 'test.person@example.com',
        phone: '+358 (40) 000-0000',
        location: ' Helsinki ',
        links: ['https://github.com/test-person', ' ', 'https://github.com/test-person'],
      },
    });
    assert.deepEqual(saved, {
      name: 'Test Person',
      email: 'test.person@example.com',
      phone: '+358 (40) 000-0000',
      location: 'Helsinki',
      links: ['https://github.com/test-person'],
    });
    assert.deepEqual(await ok<Profile>({ method: 'GET', url: '/api/profile' }), saved);

    for (const [change, message] of [
      [{ email: 'not an address' }, /email address/],
      [{ phone: 'call me' }, /phone number/],
      [{ links: ['ftp://example.com/cv'] }, /not a web address/],
      [{ links: ['github.com/test-person'] }, /not a web address/],
    ] as const) {
      const res = await call({
        method: 'PUT',
        url: '/api/profile',
        payload: { ...saved, ...change },
      });
      assert.equal(res.statusCode, 400, JSON.stringify(change));
      assert.match(res.json().message, message);
    }
    const tooMany = {
      ...saved,
      links: ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example'],
    };
    assert.equal(
      (await call({ method: 'PUT', url: '/api/profile', payload: tooMany })).statusCode,
      400,
    );
    // The name is taken off again so that the document's checks below can see it missing.
    await ok({ method: 'PUT', url: '/api/profile', payload: { ...saved, name: '' } });
  });

  test('edits: the user’s text is checked like DeepSeek’s, and DeepSeek’s stays', async () => {
    job = await ok<JobDetail>(
      {
        method: 'POST',
        url: '/api/jobs',
        payload: {
          title: 'Payments Engineer',
          company: 'Example Pay',
          url: 'https://careers.example.com/jobs/1',
          text: jobText,
        },
      },
      201,
    );
    for (const [kind, body] of [
      ['experience', facts.role],
      ['experience', facts.result],
      ['skill', facts.skills],
    ] as const) {
      const fact = await ok<Fact>(
        { method: 'POST', url: '/api/facts', payload: { kind, body } },
        201,
      );
      const updated = await ok<Fact>({
        method: 'PATCH',
        url: `/api/fact-versions/${fact.current.id}`,
        payload: { status: 'confirmed', maySendToModel: true, mayUseInMaterials: true },
      });
      if (body === facts.result) result = updated;
    }
    const snapshotId = job.snapshot!.id;
    resumeDraft = await ok<Draft>(
      { method: 'POST', url: `/api/snapshots/${snapshotId}/drafts`, payload: { kind: 'resume' } },
      201,
    );
    letter = await ok<Draft>(
      {
        method: 'POST',
        url: `/api/snapshots/${snapshotId}/drafts`,
        payload: { kind: 'cover_letter' },
      },
      201,
    );
    const statement = (text: string, draft = resumeDraft) =>
      draft.statements.find((s) => s.modelText === text)!;
    const wrongNumber = statement('Cut processing time by 45%.');
    assert.deepEqual(
      wrongNumber.problems.map((p) => p.code),
      ['number'],
    );
    assert.equal(wrongNumber.inDocument, false);

    // Fixed by the user: in the document now, DeepSeek's text kept next to it.
    let draft = (
      await edit(resumeDraft.id, wrongNumber, { text: ' Cut processing   time by about 30%. ' })
    ).json<Draft>();
    const fixed = draft.statements.find((s) => s.id === wrongNumber.id)!;
    assert.deepEqual(
      {
        text: fixed.text,
        modelText: fixed.modelText,
        edited: fixed.edited,
        problems: fixed.problems,
        inDocument: fixed.inDocument,
      },
      {
        text: 'Cut processing time by about 30%.',
        modelText: 'Cut processing time by 45%.',
        edited: true,
        problems: [],
        inDocument: true,
      },
    );
    const stored = await pool.query('select body from artifact_claim where id = $1', [
      wrongNumber.id,
    ]);
    assert.equal(stored.rows[0].body, 'Cut processing time by 45%.');

    // An edit can break a check too, and cannot make an uncited statement pass.
    const bullet = statement(facts.result);
    draft = (
      await edit(resumeDraft.id, bullet, { text: `${facts.result} Call +358 40 000 0000.` })
    ).json<Draft>();
    assert.ok(
      draft.statements
        .find((s) => s.id === bullet.id)!
        .problems.some((p) => p.code === 'sensitive'),
    );
    const uncited = statement('Led the platform team.');
    draft = (await edit(resumeDraft.id, uncited, { text: 'Led the team.' })).json<Draft>();
    assert.deepEqual(
      draft.statements.find((s) => s.id === uncited.id)!.problems.map((p) => p.code),
      ['uncited'],
    );

    // Back to DeepSeek's text, which passes; then left out by the user, and put back.
    draft = (await edit(resumeDraft.id, bullet, { text: bullet.modelText })).json<Draft>();
    assert.equal(draft.statements.find((s) => s.id === bullet.id)!.edited, false);
    draft = (await edit(resumeDraft.id, bullet, { included: false })).json<Draft>();
    let left = draft.statements.find((s) => s.id === bullet.id)!;
    assert.deepEqual([left.included, left.problems, left.inDocument], [false, [], false]);
    const edits = await count('artifact_claim_edit');
    // Saving what a statement already is adds nothing.
    await edit(resumeDraft.id, left, {});
    assert.equal(await count('artifact_claim_edit'), edits);
    draft = (await edit(resumeDraft.id, left, { included: true })).json<Draft>();
    left = draft.statements.find((s) => s.id === bullet.id)!;
    assert.equal(left.inDocument, true);
    resumeDraft = draft;

    // A statement of another draft, an unknown one, and empty text.
    assert.equal((await edit(resumeDraft.id, letter.statements[0]!, {})).statusCode, 404);
    assert.equal((await edit(uuid, bullet, {})).statusCode, 404);
    assert.equal((await edit(resumeDraft.id, bullet, { text: '   ' })).statusCode, 400);
  });

  test('the document: the statements in it with the user’s details, and what a PDF needs', async () => {
    let document = await documentOf(resumeDraft.id);
    assert.deepEqual(document.missing, ['Add your name on the Your details page.']);
    assert.equal(document.fileName, 'Resume - Example Pay - Payments Engineer');
    await ok({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        name: 'Test Person',
        email: 'test.person@example.com',
        phone: '',
        location: 'Helsinki',
        links: ['https://github.com/test-person'],
      },
    });
    document = await documentOf(resumeDraft.id);
    assert.deepEqual(document.missing, []);
    assert.equal(document.fileName, 'Test Person - Resume - Example Pay - Payments Engineer');
    assert.deepEqual(documentPieces(document.blocks), [
      'Test Person',
      'Backend developer',
      'test.person@example.com',
      'Helsinki',
      'github.com/test-person',
      'Cut processing time by about 30%.',
      'Experience',
      'Backend developer, Acme Oy, 2021-03 – 2024-06',
      facts.result,
      'Skills',
      facts.skills,
    ]);
    assert.deepEqual(document.pdfs, []);
    assert.equal(
      (await call({ method: 'GET', url: `/api/drafts/${uuid}/document` })).statusCode,
      404,
    );
  });

  test('a PDF is kept only when its text is the document’s text', async () => {
    const document = await documentOf(resumeDraft.id);
    const pieces = documentPieces(document.blocks);

    // Not a PDF, not sent as one, too large, or not readable.
    assert.equal((await upload(resumeDraft.id, Buffer.from('<html></html>'))).statusCode, 400);
    assert.equal(
      (await upload(resumeDraft.id, pdfOf(pieces), { 'content-type': 'application/octet-stream' }))
        .statusCode,
      415,
    );
    const huge = Buffer.concat([pdfOf(pieces), Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await upload(resumeDraft.id, huge)).statusCode, 413);
    const broken = await upload(resumeDraft.id, Buffer.from('%PDF-1.7 and nothing else'));
    assert.equal(broken.statusCode, 400);
    assert.match(broken.json().message, /could not be read as a PDF/);
    assert.equal((await upload(uuid, pdfOf(pieces))).statusCode, 404);

    // What a browser adds, and a line that reads differently.
    const withHeader = await ok<PdfCheck>({
      method: 'POST',
      url: `/api/drafts/${resumeDraft.id}/pdfs`,
      payload: pdfOf(['06/10/2026, 14:02', ...wrapped(pieces), `${appUrl}/drafts/x/document 1/1`]),
      headers: { 'content-type': 'application/pdf' },
    });
    assert.deepEqual(withHeader, {
      pdf: null,
      problems: [
        'The PDF has text that is not in the document: “06/10/2026, 14:02”.',
        `The PDF has text that is not in the document: “${appUrl}/drafts/x/document 1/1”.`,
      ],
    });
    const changed = pieces.map((piece) => piece.replace('about 30%', 'about 35%'));
    const differs = await upload(resumeDraft.id, pdfOf(wrapped(changed)));
    assert.equal(differs.statusCode, 200);
    assert.equal(differs.json<PdfCheck>().pdf, null);
    assert.match(
      differs.json<PdfCheck>().problems[0]!,
      /“Cut processing time by about 30%\.” is not in the PDF/,
    );
    assert.equal(await count('document_pdf'), 0);

    // The right text, wrapped like a page wraps it: kept, with the statements it was built from.
    const file = pdfOf(wrapped(pieces, 40));
    const kept = await upload(resumeDraft.id, file);
    assert.equal(kept.statusCode, 201, kept.body);
    const pdf = kept.json<PdfCheck>().pdf!;
    assert.deepEqual(
      { ...pdf, id: undefined, createdAt: undefined },
      {
        id: undefined,
        createdAt: undefined,
        fileName: 'Test Person - Resume - Example Pay - Payments Engineer.pdf',
        pages: 1,
        bytes: file.length,
        sha256: createHash('sha256').update(file).digest('hex'),
        current: true,
      },
    );
    const { rows } = await pool.query<{ claim: string; edit: string | null; text: string }>(
      `select s.artifact_claim_id as claim, e.body as edit, p.text
       from document_pdf p join document_pdf_statement s on s.document_pdf_id = p.id
         left join artifact_claim_edit e on e.id = s.artifact_claim_edit_id
       where p.id = $1`,
      [pdf.id],
    );
    const inDocument = resumeDraft.statements.filter((s) => s.inDocument);
    assert.deepEqual(new Set(rows.map((r) => r.claim)), new Set(inDocument.map((s) => s.id)));
    // The user's latest version of a statement is recorded with it, even when that is DeepSeek's
    // text put back; a statement the user never touched has none.
    assert.deepEqual(
      rows
        .filter((r) => r.edit)
        .map((r) => r.edit)
        .sort(),
      [facts.result, 'Cut processing time by about 30%.'],
    );
    assert.equal(rows[0]!.text, pieces.join('\n'));

    // The same file again is the same PDF.
    const again = await upload(resumeDraft.id, file);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json<PdfCheck>().pdf!.id, pdf.id);
    assert.equal(await count('document_pdf'), 1);

    // Downloading it: the file as uploaded, with its name, never cached.
    const download = await call({ method: 'GET', url: `/api/document-pdfs/${pdf.id}` });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.equal(
      download.headers['content-disposition'],
      `attachment; filename="Test Person - Resume - Example Pay - Payments Engineer.pdf"; filename*=UTF-8''Test%20Person%20-%20Resume%20-%20Example%20Pay%20-%20Payments%20Engineer.pdf`,
    );
    assert.equal(download.headers['cache-control'], 'private, no-store');
    assert.deepEqual(download.rawPayload, file);
    assert.equal(
      (await call({ method: 'GET', url: `/api/document-pdfs/${uuid}` })).statusCode,
      404,
    );
    const signedOut = await app.inject({ method: 'GET', url: `/api/document-pdfs/${pdf.id}` });
    assert.equal(signedOut.statusCode, 401);
    const crossSite = await app.inject({
      method: 'POST',
      url: `/api/drafts/${resumeDraft.id}/pdfs`,
      payload: file,
      headers: { cookie, 'content-type': 'application/pdf' },
    });
    assert.equal(crossSite.statusCode, 403);

    // The job page counts it.
    const detail = await ok<JobDetail>({ method: 'GET', url: `/api/jobs/${job.id}` });
    assert.deepEqual(
      detail.snapshot!.drafts.map((d) => [d.kind, d.pdfs]),
      [
        ['resume', 1],
        ['cover_letter', 0],
      ],
    );

    // A change to the document since: the PDF stays, no longer current.
    const headline = resumeDraft.statements.find((s) => s.section === 'headline')!;
    await edit(resumeDraft.id, headline, { included: false });
    const later = await documentOf(resumeDraft.id);
    assert.deepEqual(
      later.pdfs.map((p) => [p.id, p.current]),
      [[pdf.id, false]],
    );
    const old = await upload(resumeDraft.id, file);
    assert.equal(old.statusCode, 200);
    assert.deepEqual(old.json<PdfCheck>().problems, [
      'The PDF has text that is not in the document: “Backend developer”.',
    ]);
  });

  test('a cover letter, and a fact that changes after the PDF', async () => {
    const document = await documentOf(letter.id);
    const pieces = documentPieces(document.blocks);
    assert.deepEqual(pieces, [
      'Test Person',
      'test.person@example.com',
      'Helsinki',
      'github.com/test-person',
      'Dear Hiring Manager,',
      'I am applying for the Payments Engineer role at Example Pay. You are building the APIs that move money for 40,000 merchants.',
      'At Acme Oy I built the invoice API in Go and cut its processing time by about 30%.',
      'Kind regards,',
      'Test Person',
    ]);
    const kept = await upload(letter.id, pdfOf(wrapped(pieces)));
    assert.equal(kept.statusCode, 201, kept.body);

    // Editing a fact the letter cites takes its statement out: the PDF is no longer current.
    await ok(
      {
        method: 'POST',
        url: `/api/facts/${result.id}/versions`,
        payload: { body: `${facts.result}.` },
      },
      201,
    );
    const later = await documentOf(letter.id);
    assert.equal(later.pdfs[0]!.current, false);
    assert.equal(
      documentPieces(later.blocks).some((piece) => piece.startsWith('At Acme Oy')),
      false,
    );
  });
});
