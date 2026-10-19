// Run after npm run build with TEST_DATABASE_URL pointing at a disposable test server.
// All provider and application-form traffic is intercepted; the real account/database is unused.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { chromium } from 'playwright-core';
import { buildApp } from '../apps/server/src/app.ts';
import { createAccount } from '../apps/server/src/auth.ts';
import { createTestDatabase } from '../apps/server/src/testing/database.ts';
import { chatCompletion, fakeDeepSeek } from '../apps/server/src/testing/deepseek.ts';
import { fakeGreenhouse } from '../apps/server/src/testing/greenhouse.ts';
import { resumeSystemPrompt, coverLetterSystemPrompt } from '../apps/server/src/drafts/write.ts';
import { matchSystemPrompt } from '../apps/server/src/matching/match.ts';
import { interviewSystemPrompt } from '../apps/server/src/interviews/routes.ts';
import { runnerApi } from '../apps/runner/src/api.ts';
import { runTask } from '../apps/runner/src/task.ts';
import { greenhouseFormHtml, greenhouseConfirmationHtml } from '../apps/runner/src/testing/page.ts';

const output = resolve('scratch/t31');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:33131';
const secret = 't31-made-up-secret-at-least-32-characters';
const account = { name: 'Sample', email: 'sample@example.test', password: 'made up test password' };
const factText = 'Built TypeScript services with PostgreSQL.';
const jd = 'Build TypeScript services with PostgreSQL. Full-time in Helsinki. Work in English.';
const board = fakeGreenhouse({ example: [{ id: 7, title: 'Sample Engineer', content: jd }] });
const model = fakeDeepSeek(async () => {
  const request = model.requests.at(-1).body.messages;
  const system = request[0].content;
  const sent = [
    resumeSystemPrompt,
    coverLetterSystemPrompt,
    matchSystemPrompt,
    interviewSystemPrompt,
  ].includes(system)
    ? JSON.parse(request[1].content)
    : null;
  let answer;
  if (system === resumeSystemPrompt) {
    answer = {
      headline: null,
      summary: [{ text: factText, facts: [sent.facts[0].ref] }],
      experience: [],
    };
  } else if (system === coverLetterSystemPrompt) {
    answer = { paragraphs: [[{ about: 'me', text: factText, facts: [sent.facts[0].ref] }]] };
  } else if (system === matchSystemPrompt) {
    answer = {
      requirements: sent.requirements.map(({ ref }) => ({
        ref,
        outcome: 'met',
        facts: [sent.facts[0].ref],
        note: 'The cited fact describes the required work.',
      })),
    };
  } else if (system === interviewSystemPrompt) {
    const material = sent.sources.find((source) => source.kind === 'material').ref;
    answer = {
      technical: [{ text: 'How would you design the service?', sources: ['J1'] }],
      projects: [{ text: 'What tradeoffs did you make?', sources: [material] }],
      stories: [
        {
          title: 'Service project',
          situation: null,
          task: null,
          action: factText,
          result: null,
          missing: ['What changed?'],
          sources: [material],
        },
      ],
      interviewer: [{ text: 'How does the team review changes?', sources: ['J1'] }],
    };
  } else {
    answer = {
      responsibilities: [],
      requirements: [
        {
          kind: 'must',
          text: 'TypeScript services with PostgreSQL',
          quote: 'TypeScript services with PostgreSQL',
        },
      ],
      fields: {},
    };
  }
  return chatCompletion(JSON.stringify(answer));
}, board.fetch);
const db = await createTestDatabase();
const pool = new Pool({ connectionString: db.url });
const app = buildApp({
  webRoot: resolve('apps/web/dist/web/browser'),
  databaseUrl: db.url,
  authSecret: secret,
  appUrl: origin,
  trustedOrigins: [origin],
  fetch: model.fetch,
  deepseekApiKey: 'sk-made-up',
});
let browser;
const checks = [];
const errors = [];
const check = (name) => {
  checks.push(name);
  console.log(name);
};
try {
  await createAccount({ pool, secret, appUrl: origin, trustedOrigins: [origin] }, account);
  await app.listen({ host: '127.0.0.1', port: 33131 });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const api = async (method, path, data) => {
    const response = await page.request.fetch(origin + path, { method, data, headers: { origin } });
    assert(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.status() === 204 ? null : response.json();
  };
  const go = async (path) => {
    await page.goto(origin + path);
    await page.locator('h1').waitFor();
  };
  const click = async (name) => {
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
  };
  const action = async (name, path) => {
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === path && r.request().method() === 'POST',
    );
    await click(name);
    const result = await response;
    assert(result.ok(), await result.text());
    return result.json();
  };
  await go('/facts?run=sample#review');
  assert.equal(new URL(page.url()).searchParams.get('next'), '/facts?run=sample#review');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.route(
    '**/api/auth/sign-in/email',
    (route) => route.fulfill({ status: 503, json: { message: 'Temporary sample failure' } }),
    { times: 1 },
  );
  await click('Sign in');
  await page.getByRole('alert').filter({ hasText: 'Signing in failed' }).waitFor();
  await click('Sign in');
  await page.waitForURL(origin + '/facts?run=sample#review');
  await page.getByRole('heading', { name: 'A short guide to your workbench' }).waitFor();
  await click('Skip guide');
  await page.getByText('No facts yet.', { exact: false }).waitFor();
  check('First sign-in, same-credentials retry, deep-link return and skippable guide');

  await page.getByText('Add a fact', { exact: true }).click();
  await page.locator('app-facts form textarea').fill(factText);
  const created = await action('Add', '/api/facts');
  assert.equal(created.current.status, 'proposed');
  assert.equal(created.current.maySendToModel, false);
  assert.equal(created.current.mayUseInMaterials, false);
  await click('Confirm');
  await page
    .getByRole('status')
    .filter({ hasText: 'Confirmed. The saved permissions now apply.' })
    .waitFor();
  await page.locator('.filters select').first().selectOption('all');
  const card = page.locator('app-fact-card').first();
  await card.getByText('Permissions', { exact: true }).click();
  await card.getByLabel('Allow sending to DeepSeek', { exact: true }).check();
  await card.getByLabel('Allow use in materials', { exact: true }).check();
  await card
    .getByText('Usable in materials: yes · Allowed for DeepSeek: yes', { exact: true })
    .waitFor();
  check('New fact defaults off; confirmation and independent permissions through the UI');

  await go('/profile');
  await page.getByLabel('Name', { exact: true }).fill('Sample Person');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page
    .getByLabel('Where you live, as documents should say it (such as a city)', { exact: true })
    .fill('Helsinki');
  await click('Save');
  await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
  await api('POST', '/api/sources', { catalogId: 'greenhouse_board', param: 'example' });
  await api('POST', '/api/discovery-runs', {});
  const job = (await api('GET', '/api/jobs')).jobs[0];
  await go('/jobs/' + job.id);
  await page.getByText('Paste original text instead', { exact: true }).click();
  await page.locator('app-paste-text-form textarea').fill(jd);
  await action('Save the text', `/api/jobs/${job.id}/text`);
  const detail = await api('GET', '/api/jobs/' + job.id);
  const snapshot = detail.snapshot.id;
  await action('Summarise with DeepSeek', `/api/snapshots/${snapshot}/summary`);
  await action('Match with my facts', `/api/snapshots/${snapshot}/match`);
  check('Original JD pasted into discovered job; real summary/match APIs with fake provider');

  const drafts = [];
  for (const [kind, name] of [
    ['resume', 'Write a resume'],
    ['cover_letter', 'Write a cover letter'],
  ]) {
    const draft = await action(name, `/api/snapshots/${snapshot}/drafts`);
    drafts.push(draft.id);
    await go('/drafts/' + draft.id);
    await page.locator('app-statement-review').first().waitFor();
    assert((await page.locator('app-statement-review').first().innerText()).includes(factText));
    await page
      .getByRole('link', { name: 'See the finished document and save its PDF', exact: true })
      .click();
    await page.locator('app-document-sheet').waitFor();
    const pdf = await page.pdf({
      path: `${output}/${kind}.pdf`,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
    });
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/pdfs') && r.request().method() === 'POST',
    );
    await page
      .getByLabel('Upload the PDF', { exact: true })
      .setInputFiles({ name: kind + '.pdf', mimeType: 'application/pdf', buffer: pdf });
    const response = await saved;
    assert(response.ok(), await response.text());
    assert((await response.json()).pdf);
    await page.getByText('Current PDF', { exact: true }).waitFor();
    await go('/jobs/' + job.id);
  }
  check(
    'Both drafts cite facts; Chrome A4 PDFs pass the real server text/bounds check and become current',
  );

  await action('Read the application form', `/api/jobs/${job.id}/form`);
  for (const [key, answer] of [
    ['first_name', ['Sample']],
    ['last_name', ['Person']],
    ['question_102', ['No']],
    ['question_103', ['One month']],
    ['gdpr_processing_consent_given', ['yes']],
  ]) {
    await api('PUT', `/api/jobs/${job.id}/form/answers/${key}`, { answer });
  }
  const issued = await api('POST', '/api/runner-tokens', { name: 'Acceptance fixture' });
  const runner = runnerApi(new URL(origin), issued.token);
  await go('/jobs/' + job.id);
  await action('Fill in the form with the runner', `/api/jobs/${job.id}/fill`);
  const task = await runner.claim();
  assert(task);
  let posts = 0;
  let formPage;
  const running = runTask(task, {
    api: runner,
    signal: AbortSignal.timeout(60_000),
    pollMs: 100,
    log: (line) => console.log('Runner:', line),
    open: async () => {
      const context = await browser.newContext();
      await context.route('**/*', (route) => {
        assert.equal(new URL(route.request().url()).hostname, 'job-boards.greenhouse.io');
        if (route.request().method() === 'POST') {
          posts++;
          return route.fulfill({ json: {} });
        }
        return route.fulfill({
          contentType: 'text/html',
          body: new URL(route.request().url()).pathname.endsWith('/confirmation')
            ? greenhouseConfirmationHtml
            : greenhouseFormHtml,
        });
      });
      formPage = await context.newPage();
      return formPage;
    },
  });
  // Refresh only this local fixture; the production UI retains its explicit refresh control.
  for (let i = 0; i < 80; i++) {
    const state = (await api('GET', `/api/jobs/${job.id}/fill`)).task?.status;
    if (state === 'filled') break;
    if (state === 'paused') {
      assert.equal(posts, 0);
      await formPage.locator('#country').fill('Finland');
      await formPage.getByText('Finland +358', { exact: true }).click();
      await formPage.getByLabel('Finland', { exact: true }).check();
      await formPage.locator('[id="question_105[]"]').fill('English');
      await formPage.getByText('English', { exact: true }).click();
      await go('/jobs/' + job.id);
      await click('Continue');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await go('/jobs/' + job.id);
  await page.getByRole('button', { name: 'Approve and submit', exact: true }).waitFor();
  assert.equal(posts, 0);
  assert(await page.locator('app-job-fill .fields').isVisible());
  await click('Approve and submit');
  await running;
  assert.equal(posts, 1);
  const application = (await api('GET', `/api/jobs/${job.id}/fill`)).application;
  assert.equal(application.status, 'submitted');
  check(
    'Actual runner fills a fully intercepted Chrome form, previews first, submits once after UI approval',
  );

  await go('/applications/' + application.id);
  await page.getByRole('heading', { name: /Sample Engineer/ }).waitFor();
  const record = await api('GET', '/api/applications/' + application.id);
  for (const file of record.files) {
    const bytes = await (
      await page.request.get(origin + '/api/application-files/' + file.id)
    ).body();
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  await go(`/applications/${application.id}/interview`);
  await action('Generate interview practice', `/api/applications/${application.id}/interview`);
  await page
    .getByLabel('Your additions and practice notes — to confirm', { exact: true })
    .fill('Private sample note');
  await click('Save notes');
  await page.getByRole('status').filter({ hasText: 'Notes saved.' }).waitFor();
  assert.equal(model.requests.length, 5);
  assert(!JSON.stringify(model.requests).includes(account.email));
  assert(!JSON.stringify(model.requests).includes('Private sample note'));
  check(
    'Frozen application files retain SHA-256; interview uses frozen materials; private notes/contact excluded',
  );

  const paths = [
    '/',
    '/jobs',
    '/jobs/paste',
    '/jobs/alerts',
    `/jobs/${job.id}`,
    '/runs',
    '/applications',
    `/applications/${application.id}`,
    `/applications/${application.id}/interview`,
    ...drafts.flatMap((id) => [`/drafts/${id}`, `/drafts/${id}/document`]),
    '/facts',
    '/profile',
    '/answers',
    '/criteria',
    '/sources',
    '/runner',
    '/export',
    '/unknown',
  ];
  for (const width of [1440, 1024, 768, 390, 360])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const path of paths) {
        await go(path);
        await page.waitForLoadState('networkidle');
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          `${width} ${theme} ${path}`,
        );
        assert.equal(
          await page.locator('main').evaluate((el) => el === document.activeElement),
          true,
        );
      }
      await page.screenshot({ path: `${output}/workflow-${width}-${theme}.png`, fullPage: true });
    }
  check(
    `${paths.length} populated routes × five widths × light/dark; focus, deep links, reduced motion and overflow`,
  );
  const resources = [
    ['/', '/api/facts'],
    ['/facts', '/api/facts'],
    ['/jobs', '/api/jobs'],
    [`/jobs/${job.id}`, `/api/jobs/${job.id}`],
    ...drafts.flatMap((id) => [
      [`/drafts/${id}`, `/api/drafts/${id}`],
      [`/drafts/${id}/document`, `/api/drafts/${id}/document`],
    ]),
    ['/applications', '/api/applications'],
    [`/applications/${application.id}`, `/api/applications/${application.id}`],
    [`/applications/${application.id}/interview`, `/api/applications/${application.id}/interview`],
    ...['profile', 'answers', 'criteria', 'sources', 'runs'].map((name) => [
      '/' + name,
      '/api/' + name,
    ]),
    ['/runner', '/api/runner-tokens'],
  ];
  for (const [width, theme] of [
    [1440, 'light'],
    [360, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    for (const [path, endpoint] of resources) {
      let release;
      const ready = new Promise((resolve) => {
        release = resolve;
      });
      const failure = async (route) => {
        await ready;
        await route.fulfill({ status: 503, json: { message: 'Sample temporary failure' } });
      };
      await page.route(origin + endpoint, failure);
      await page.goto(origin + path);
      await page
        .getByRole('status')
        .filter({ hasText: /Loading/ })
        .first()
        .waitFor();
      release();
      await page.getByRole('alert').first().waitFor();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${path} error`,
      );
      await page.unroute(origin + endpoint, failure);
      const retried = page.waitForResponse(
        (r) => new URL(r.url()).pathname === endpoint && r.request().method() === 'GET',
      );
      await page
        .getByRole('button', { name: /^(Try again|Retry|Retry loading)$/ })
        .first()
        .click();
      assert((await retried).ok(), path);
      await page
        .getByRole('alert')
        .filter({ hasText: 'Sample temporary failure' })
        .waitFor({ state: 'detached' });
    }
  }
  check(
    `${resources.length} resource routes: loading → error → retry through the real APIs, wide/light and narrow/dark`,
  );
  const touch = await browser.newContext({
    storageState: await page.context().storageState(),
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const touchPage = await touch.newPage();
  await touchPage.goto(origin + '/facts');
  await touchPage.locator('.nav-menu summary').tap();
  await touchPage
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Jobs', exact: true })
    .tap();
  await touchPage.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
  assert.equal(await touchPage.locator('.nav-menu').evaluate((el) => el.open), false);
  await touch.close();
  check('Synthesized mobile touch opens Menu, navigates and closes it');
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/workflow-results.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        checks,
        errors,
        routes: paths,
        modelRequests: model.requests.length,
        formPosts: posts,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await app.close();
  await pool.end();
  await db.drop();
}
