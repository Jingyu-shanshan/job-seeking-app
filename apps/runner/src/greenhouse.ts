import type { FillField, PageBlocker, PageField } from '@jsa/shared';
import type { Locator, Page } from 'playwright-core';
import { type RawField, findBlocker, readGreenhouseForm } from './page-readers.ts';

// Greenhouse's hosted application form (T17), the first form the runner fills. The app's keys for
// its questions are Greenhouse's field names (T16), which are the page's ids, except for the
// location search and the demographic questions. The runner types, picks options, ticks boxes and
// attaches files; it never presses Enter or clicks Submit, so the form is never sent.

/** Greenhouse's own form, which the runner fills; any other page it refuses. */
export function isGreenhouseForm(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname === 'job-boards.greenhouse.io';
  } catch {
    return false;
  }
}

/** The page's id of the field for one of the app's questions. */
export function pageId(key: string): string {
  if (key === 'location') return 'candidate-location';
  return /^demographic_(\d+)$/.exec(key)?.[1] ?? key;
}

/** The app's key for a field of the page. */
export function keyOf(field: Pick<RawField, 'id' | 'demographic'>): string {
  if (field.id === 'candidate-location') return 'location';
  return field.demographic && /^\d+$/.test(field.id) ? `demographic_${field.id}` : field.id;
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** The fields as the app takes them: by the app's keys, within the app's limits. */
export function pageFields(raw: readonly RawField[]): PageField[] {
  return raw.slice(0, 500).map((field) => ({
    key: cut(keyOf(field), 200),
    label: cut(field.label, 2000),
    required: field.required,
    kind: field.kind,
    value: field.value.slice(0, 1000).map((value) => cut(value, 10_000)),
  }));
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;
/** Greenhouse's group around a file question. */
const uploadGroup = (id: string) =>
  `[role="group"][aria-labelledby=${quoted(`upload-label-${id}`)}]`;

const byId = (page: Page, id: string) => page.locator(`[id=${quoted(id)}]`);
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Text that is exactly `value`, give or take spacing. */
const exactly = (value: string) =>
  new RegExp(`^\\s*${literal(value.trim()).replace(/\s+/g, '\\s+')}\\s*$`);

/** Picks the option worded `value` in one of Greenhouse's searchable selects. */
async function choose(page: Page, input: Locator, id: string, value: string, timeout: number) {
  const options = page.locator(`[id^=${quoted(`react-select-${id}-option-`)}]`);
  const deadline = Date.now() + timeout;
  try {
    // Clicking the select opens its list, and typing the option's words keeps the options that
    // contain them. On Greenhouse's pages typing alone did not open the list (seen 2026-10-07), and
    // a list may still not open while the page settles, so the runner tries again until it does.
    const control = page.locator('.select__container', { has: input }).locator('.select__control');
    for (;;) {
      if (await control.count())
        await control
          .first()
          .click({ timeout: 2000 })
          .catch(() => undefined);
      await input.fill(value);
      const opened = await options
        .first()
        .waitFor({ timeout: Math.min(1000, Math.max(deadline - Date.now(), 1)) })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
      if (Date.now() >= deadline) throw new Error('Its list of options did not open.');
      await input.fill('');
    }
    await options
      .filter({ hasText: exactly(value) })
      .first()
      .click({ timeout: Math.max(deadline - Date.now(), 1000) });
  } catch (error) {
    // Leave the select as it was; the look after filling shows the field as empty.
    await input.fill('');
    await input.blur();
    throw error;
  }
}

/** Ticks the checkbox `box` through its label, as Greenhouse's styled boxes need. */
async function tick(page: Page, box: Locator) {
  if (await box.isChecked()) return;
  const id = await box.getAttribute('id');
  const label = id ? page.locator(`label[for=${quoted(id)}]`) : undefined;
  if (label && (await label.count())) await label.first().click();
  else await box.check();
}

/**
 * Puts the runner's answer for one question into the page; nothing when the page has no such
 * field. The page decides how: a searchable select, a checkbox group, one checkbox, a file input
 * or a text field.
 */
async function fillField(page: Page, field: FillField, file: Buffer | undefined) {
  const id = pageId(field.key);
  const control = byId(page, id).first();
  if (!(await control.count())) return;
  const how = await control.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') ?? '',
    role: el.getAttribute('role') ?? '',
  }));
  if (how.tag === 'fieldset') {
    for (const value of field.answer) {
      const label = control
        .locator('label')
        .filter({ hasText: exactly(value) })
        .first();
      const boxId = await label.getAttribute('for', { timeout: 2000 });
      if (boxId) await tick(page, byId(page, boxId));
    }
  } else if (how.type === 'file') {
    if (!file) return;
    const upload = { name: field.answer[0]!, mimeType: 'application/pdf', buffer: file };
    // Greenhouse shows the file's name once it has taken the file; until its script is ready it
    // refuses it, so the runner tries once more.
    const shown = page.locator(`${uploadGroup(id)} .file-upload__filename`);
    for (let attempt = 1; ; attempt++) {
      await control.setInputFiles(upload);
      if (!(await page.locator(uploadGroup(id)).count())) return;
      const taken = await shown
        .first()
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (taken) return;
      if (attempt === 2 || !(await control.count()))
        throw new Error('The page did not take the file.');
    }
  } else if (how.type === 'checkbox') {
    await tick(page, control);
  } else if (how.role === 'combobox') {
    // The location is a search, whose options take a moment to come.
    const timeout = field.key === 'location' ? 10_000 : 5000;
    for (const value of field.answer) await choose(page, control, id, value, timeout);
  } else {
    await control.fill(field.answer.join('\n'));
  }
}

/**
 * Fills every question the runner has an answer for. A field that does not take its answer is left
 * for the look afterwards, which shows it to the user. Returns the questions that failed, with why.
 */
export async function fillGreenhouseForm(
  page: Page,
  fields: readonly FillField[],
  files: ReadonlyMap<string, Buffer>,
): Promise<string[]> {
  const failed: string[] = [];
  for (const field of fields) {
    if (!field.answer.length) continue;
    try {
      await fillField(page, field, files.get(field.key));
    } catch (error) {
      if (page.isClosed()) throw error;
      failed.push(`${field.label}: ${(error as Error).message.split('\n', 1)[0]}`);
    }
  }
  return failed;
}

export interface Look {
  /** Null when the page has no Greenhouse application form. */
  fields: PageField[] | null;
  blocker: PageBlocker | null;
  /** A PNG of the form, or of the page when it has no form. */
  screenshot: Buffer;
}

const maxScreenshot = 8 * 1024 * 1024;

/** What the page shows now: the form's fields with their values, a blocker, and a screenshot. */
export async function lookAt(page: Page): Promise<Look> {
  const blocker = await page.evaluate(findBlocker);
  const raw = await page.evaluate(readGreenhouseForm);
  const form = page.locator('form#application-form');
  const whole = () => page.screenshot({ fullPage: true });
  // The page's script may replace the form while it is being taken: the whole page then.
  let screenshot = raw ? await form.screenshot().catch(whole) : await whole();
  // A very long page: what the window shows.
  if (screenshot.length > maxScreenshot) screenshot = await page.screenshot();
  return { fields: raw && pageFields(raw), blocker, screenshot };
}
