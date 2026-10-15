import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const design = resolve(root, 'docs/designs/t24');
const output = resolve(root, 'scratch/t24');
const sandbox = {};
runInNewContext(await readFile(resolve(design, 'screens.js'), 'utf8'), sandbox);
const { screens, opStates } = sandbox.T24;
const routes = [
  ...(await readFile(resolve(root, 'apps/web/src/app/app.routes.ts'), 'utf8')).matchAll(
    /path: '([^']*)'/g,
  ),
].map((match) => (match[1] === '**' ? '**' : '/' + match[1]));
assert.deepEqual(
  [
    ...new Set(
      screens.filter((screen) => screen.route !== 'Electron toolbar').map((screen) => screen.route),
    ),
  ].sort(),
  [...new Set(routes)].sort(),
);
assert.equal(new Set(screens.map((screen) => screen.id)).size, screens.length);
for (const screen of screens) {
  await readFile(resolve(root, screen.file));
  assert.ok(screen.views.normal, screen.id);
  assert.equal(new Set(screen.actions.map((action) => action.id)).size, screen.actions.length);
  for (const action of screen.actions)
    for (const state of ['label', 'busy', 'error', 'blocked', 'success'])
      assert.ok(action[state]?.length, `${screen.id}/${action.id}/${state}`);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1488, height: 1100 },
  bypassCSP: true,
});
const page = await context.newPage();
const errors = [];
const network = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (/^https?:/.test(request.url())) network.push(request.url());
});
const url = pathToFileURL(resolve(design, 'index.html')).href;
let cases = 0;
const captures = [];
async function show(screen, params = {}) {
  await page.goto(`${url}#${screen}?${new URLSearchParams(params)}`);
  const expected = [
    screen,
    params.view ?? 'normal',
    params.action ?? '',
    params.state ?? 'ready',
    params.theme ?? 'light',
    params.width ?? 'auto',
  ].join('/');
  await page
    .waitForFunction(
      (frame) => document.querySelector('#preview')?.dataset.frame === frame,
      expected,
      { timeout: 5000 },
    )
    .catch(async (error) => {
      throw new Error(
        `${screen}/${JSON.stringify(params)} rendered ${await page.locator('#preview').getAttribute('data-frame')}; ${errors.join('; ')}; ${error.message}`,
      );
    });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    `${screen}/${JSON.stringify(params)} page overflow`,
  );
  assert.equal(
    await page.locator('#preview').evaluate((node) => node.scrollWidth > node.clientWidth),
    false,
    `${screen}/${JSON.stringify(params)} pane overflow`,
  );
  cases++;
}

try {
  for (const screen of screens) {
    for (const view of Object.keys(screen.views)) await show(screen.id, { view, width: '360' });
    for (const action of screen.actions)
      for (const state of opStates) {
        await show(screen.id, { action: action.id, state, width: '360' });
        const control = page
          .locator(`[data-operation="${action.id}"]`)
          .locator('button, input')
          .first();
        if (await control.count())
          assert.equal(
            await control.isDisabled(),
            state === 'busy' ||
              state === 'blocked' ||
              (action.id === 'approve' && state === 'error'),
            `${screen.id}/${action.id}/${state}`,
          );
        else
          assert.equal(
            state,
            'success',
            `${screen.id}/${action.id} disappears only after completion`,
          );
        if (state !== 'ready')
          assert.equal(await page.locator('#action-feedback').textContent(), action[state]);
      }
    for (const width of ['1440', '1024', '768', '605', '390', '360'])
      for (const theme of ['light', 'dark']) await show(screen.id, { width, theme });
  }

  await show('facts', { width: '1440' });
  assert.equal(await page.locator('#withdrawn').evaluate((node) => node.open), false);
  await show('facts', { view: 'sensitive' });
  assert.equal(await page.locator('[data-action="permissions"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="material-permission"]').isDisabled(), false);
  await show('approval');
  assert.equal(await page.locator('[data-action="approve"]').isVisible(), true);
  assert.equal(await page.locator('[data-action="settle-yes"]').isVisible(), false);
  await show('approval', { view: 'to-verify' });
  assert.equal(await page.locator('[data-action="approve"]').isVisible(), false);
  assert.equal(await page.locator('[data-action="settle-yes"]').isVisible(), true);
  await show('facts', { view: 'session-expired' });
  assert.equal(await page.locator('#preview nav[aria-label="Main"]').count(), 0);
  await show('facts', { width: '360' });
  const menu = page.locator('.nav-menu');
  assert.equal(await menu.evaluate((node) => node.open), false);
  await menu.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await menu.evaluate((node) => node.open), true);
  await page.locator('#preview .skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.locator('#main-content').evaluate((node) => node === document.activeElement),
    true,
  );
  await page.locator('#screen').selectOption('candidates');
  await page.waitForFunction(
    () => document.querySelector('#main-content h1').textContent === 'Review candidates',
  );
  await page.locator('#action').selectOption('save-candidates');
  await page.locator('#state').selectOption('error');
  await page.locator('#action-feedback').waitFor();
  assert.match(await page.locator('#action-feedback').textContent(), /corrections and selections/);

  await show('facts', { view: 'filtered' });
  assert.equal(await page.locator('#withdrawn').count(), 1);
  await show('facts', { action: 'confirm', state: 'success' });
  assert.equal(await page.locator('.content .panel .badge').first().textContent(), 'Confirmed');
  assert.equal(await page.locator('.content .panel').first().locator('input:checked').count(), 0);
  await show('facts', { action: 'withdraw', state: 'success' });
  assert.equal(await page.locator('#withdrawn .panel').count(), 2);
  await show('facts', { action: 'restore', state: 'success' });
  assert.equal(await page.locator('#withdrawn .panel').count(), 0);
  await show('candidates', { view: 'markdown' });
  assert.equal(await page.locator('.content .panel select').count(), 2);
  assert.equal(
    await page.locator('.content').evaluate((n) => /pages|Pages|\.pdf/.test(n.textContent)),
    false,
  );
  await show('candidates', { view: 'cancelled', action: 'save-candidates', state: 'success' });
  assert.match(await page.locator('#action-feedback').textContent(), /Added 0.*cancelled 2/);
  await show('candidates', { view: 'duplicates' });
  assert.equal(await page.locator('.content .panel').count(), 4);
  assert.equal(await page.locator('.content .panel select').count(), 4);
  await show('interview', { view: 'external' });
  assert.equal(await page.locator('[data-action="generate-practice"]').isDisabled(), true);
  await show('interview', { view: 'omitted' });
  assert.equal(await page.locator('[data-action="generate-practice"]').isDisabled(), true);
  assert.equal(
    await page.locator('.content').evaluate((n) => n.textContent.includes('M1 ·')),
    false,
  );
  for (const view of ['approved', 'submitting', 'applied', 'not-submitted']) {
    await show('approval', { view });
    assert.equal(await page.locator('[data-action="approve"]').isVisible(), false);
    if (view === 'submitting')
      assert.equal(await page.locator('[data-action="close-fill"]').isVisible(), false);
  }
  await show('approval', { action: 'approve', state: 'success' });
  assert.equal(await page.locator('[data-action="approve"]').isVisible(), false);
  await show('job', { view: 'no-text' });
  assert.equal(await page.locator('[data-action="summary"]').count(), 0);
  for (const view of ['unknown', 'unsupported']) {
    await show('form', { view });
    assert.equal(await page.locator('[data-action="start-fill"]').isDisabled(), true);
  }
  for (const view of ['budget', 'model-busy']) {
    await show('runs', { view });
    assert.equal(await page.locator('[data-action="resume-run"]').isDisabled(), true);
  }
  for (const [screen, action] of [
    ['answers', 'save-answer-record'],
    ['sources', 'add-source'],
    ['runs', 'save-preset'],
    ['runner', 'issue-token'],
    ['alerts', 'import-emails'],
  ]) {
    await show(screen, { view: 'empty' });
    assert.equal(await page.locator(`[data-action="${action}"]`).isVisible(), true);
  }
  await show('document', { view: 'missing' });
  assert.equal(await page.locator('[data-action="print"]').isDisabled(), true);
  await show('draft', { view: 'empty' });
  assert.equal(await page.locator('.content .badge').first().textContent(), 'Left out');
  await show('draft', { view: 'invalid' });
  assert.equal(
    await page
      .locator('.content')
      .evaluate((node) => /No wording changes|Why the checks passed/.test(node.textContent)),
    false,
  );
  assert.match(await page.locator('.content details[open]').textContent(), /Number check.*twelve/);
  await show('draft', { width: '390' });
  assert.equal(await page.locator('.columns .panel').count(), 1);
  await show('runner', { view: 'issued' });
  assert.match(await page.locator('.content pre').textContent(), /NOT A REAL CREDENTIAL/);
  await show('runner', { view: 'revoked' });
  assert.equal(await page.locator('[data-action="revoke-token"]').isVisible(), false);

  const axePath = resolve(root, 'scratch/t22/node_modules/axe-core/axe.min.js');
  const axe = await readFile(axePath, 'utf8').catch(() => null);
  const accessibility = [];
  if (axe)
    for (const screen of screens)
      for (const theme of ['light', 'dark']) {
        await show(screen.id, { width: '390', theme });
        await page.evaluate(axe);
        const result = await page.evaluate(async () =>
          (
            await globalThis.axe.run(document, {
              runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
            })
          ).violations.map((v) => ({ id: v.id, targets: v.nodes.map((node) => node.target) })),
        );
        accessibility.push({ screen: screen.id, theme, violations: result });
      }

  for (const [name, screen, params] of [
    ['facts-desktop', 'facts', { width: '1440' }],
    ['facts-mobile-dark', 'facts', { width: '390', theme: 'dark' }],
    [
      'candidates-mobile',
      'candidates',
      { width: '360', action: 'save-candidates', state: 'error' },
    ],
    ['approval-pane', 'approval', { width: '605' }],
    ['application-desktop', 'application', { width: '1024' }],
    ['profile-tablet', 'profile', { width: '768' }],
    ['runs-desktop', 'runs', { width: '1440', theme: 'dark' }],
    ['document-mobile', 'document', { width: '390' }],
    ['desktop-toolbar', 'desktop', { width: '605' }],
    ['interview-excerpt', 'interview', { width: '1024', view: 'external' }],
  ]) {
    await show(screen, params);
    const path = resolve(output, `${name}.png`);
    await page.locator('#preview').screenshot({ path });
    captures.push(path);
  }
  assert.ok(
    accessibility.every((item) => item.violations.length === 0),
    JSON.stringify(accessibility.filter((item) => item.violations.length)),
  );
  assert.deepEqual(network, [], 'Design preview must never call a remote service');
  assert.deepEqual(errors, [], 'All page and action states must render');
  const result = {
    screens: screens.length,
    routes: new Set(routes).size,
    actions: screens.reduce((sum, screen) => sum + screen.actions.length, 0),
    pageStates: screens.reduce((sum, screen) => sum + Object.keys(screen.views).length, 0),
    cases,
    accessibility: axe
      ? accessibility
      : 'Not run: reuse scratch/t22 axe-core for this optional check',
    captures,
    errors,
    network,
  };
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        ...result,
        accessibility: axe
          ? accessibility.filter((item) => item.violations.length)
          : result.accessibility,
        captures: captures.length,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
