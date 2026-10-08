import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  FillField,
  FormCheckRequest,
  RunnerTask,
  RunnerTaskState,
  SubmitProgress,
  SubmitResultRequest,
} from '@jsa/shared';
import { type Browser, type Page, chromium } from 'playwright-core';
import { Unauthorized, type RunnerApi } from './api.ts';
import { runRunner } from './runner.ts';
import { type TaskOptions, runTask } from './task.ts';
import { greenhouseConfirmationHtml, greenhouseFormHtml } from './testing/page.ts';

// The runner in a real browser: the installed Google Chrome, without a window. The form is the
// made-up one of the tests, served for Greenhouse's address inside the browser, so nothing goes
// to Greenhouse. In CI Chrome must be there; on a computer without it these tests are skipped.

const chrome = await chromium.launch({ channel: 'chrome', headless: true }).catch((error) => {
  if (process.env.CI) throw error;
  return undefined;
});

const url = 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=7';
const pdfId = '00000000-0000-4000-8000-000000000001';
const pdf = Buffer.from('%PDF-1.7\n% made up\n');

const field = (f: Partial<FillField> & Pick<FillField, 'key' | 'label'>): FillField => ({
  kind: 'text',
  group: 'questions',
  required: true,
  answer: [],
  source: 'job',
  documentPdfId: null,
  ...f,
});

const fields: FillField[] = [
  field({ key: 'first_name', label: 'First Name', answer: ['Test'] }),
  field({ key: 'last_name', label: 'Last Name', answer: ['Person'] }),
  field({ key: 'email', label: 'Email', answer: ['test.person@example.com'], source: 'profile' }),
  field({ key: 'phone', label: 'Phone', answer: ['+358 40 000 0000'], source: 'profile' }),
  field({
    key: 'resume',
    label: 'Resume/CV',
    kind: 'file',
    answer: ['Test Person - Resume.pdf'],
    source: 'document',
    documentPdfId: pdfId,
  }),
  field({
    key: 'cover_letter',
    label: 'Cover Letter',
    kind: 'file',
    required: false,
    source: null,
  }),
  field({
    key: 'question_101',
    label: 'LinkedIn Profile',
    answer: ['https://example.com/in/test'],
  }),
  field({ key: 'question_102', label: 'Visa?', kind: 'single', answer: ['No'] }),
  field({ key: 'question_103', label: 'Notice period', kind: 'textarea', answer: ['One month'] }),
  field({
    key: 'question_104[]',
    label: 'Countries',
    kind: 'multi',
    answer: ['Finland', 'Estonia'],
  }),
  field({
    key: 'question_105[]',
    label: 'Languages',
    kind: 'multi',
    answer: ['English', 'Finnish'],
  }),
  field({ key: 'location', label: 'Location', group: 'location', answer: ['Helsinki'] }),
  // Held back: the runner leaves it alone.
  field({ key: 'gender', label: 'Gender', kind: 'single', group: 'compliance', source: null }),
  field({ key: 'demographic_4001', label: 'Group?', kind: 'single', answer: ['Yes'] }),
  field({
    key: 'gdpr_processing_consent_given',
    label: 'Consent',
    kind: 'consent',
    group: 'consent',
    answer: ['Consent given'],
  }),
];

const task = (more: Partial<RunnerTask> = {}): RunnerTask => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  url,
  title: 'Platform Engineer',
  company: 'Example Oy',
  fields,
  ...more,
});

/**
 * The app as the runner sees it: each look at the form answers with the next of `afterChecks`, and
 * each status poll with the next of `polls`. `onCheck` runs in the page's time, as the user would.
 * The look before Submit (T18) lets the runner press it when the next of `goes` is true; `onProgress`
 * runs when the runner tells what the page shows after Submit.
 */
function fakeApp({
  afterChecks,
  polls,
  onCheck,
  goes = [],
  onProgress,
}: {
  afterChecks: RunnerTaskState['status'][];
  polls: RunnerTaskState['status'][];
  onCheck?: (check: FormCheckRequest, page: Page) => Promise<void>;
  goes?: boolean[];
  onProgress?: (shows: SubmitProgress, page: Page) => Promise<void>;
}) {
  const seen = {
    checks: [] as FormCheckRequest[],
    failures: [] as string[],
    windowClosed: 0,
    files: [] as string[],
    submitted: [] as (string | null)[],
    beforeSubmit: [] as FormCheckRequest[],
    progress: [] as SubmitProgress[],
    results: [] as SubmitResultRequest[],
    /** The applications that reached the made-up Greenhouse. */
    posts: 0,
  };
  let page: Page | undefined;
  const state = (status: RunnerTaskState['status']) => ({ status, message: `Now ${status}.` });
  const api: TaskOptions['api'] = {
    async state() {
      return state(polls.shift() ?? 'closed');
    },
    async file(_id, fileId) {
      seen.files.push(fileId);
      return pdf;
    },
    async check(_id, check) {
      seen.checks.push(check);
      seen.submitted.push(await page!.evaluate(() => document.body.dataset.submitted ?? null));
      await onCheck?.(check, page!);
      return state(afterChecks.shift() ?? 'closed');
    },
    async fail(_id, message) {
      seen.failures.push(message);
      return state('failed');
    },
    async windowClosed() {
      seen.windowClosed++;
      return state('closed');
    },
    async submit(_id, look) {
      seen.beforeSubmit.push(look);
      const go = goes.shift() ?? false;
      return { go, state: state(go ? 'submitting' : (polls.shift() ?? 'closed')) };
    },
    async progress(_id, shows) {
      seen.progress.push(shows);
      await onProgress?.(shows, page!);
      return state('submitting');
    },
    async result(_id, result) {
      seen.results.push(result);
      return state(result.confirmation ? 'submitted' : 'to_verify');
    },
  };
  /**
   * A window whose Greenhouse pages are `html`, and the confirmation page. An application sent to
   * the made-up Greenhouse is counted, never sent anywhere.
   */
  const open =
    (html = greenhouseFormHtml) =>
    async () => {
      const context = await chrome!.newContext();
      await context.route('https://job-boards.greenhouse.io/**', (route) => {
        const { pathname } = new URL(route.request().url());
        if (route.request().method() === 'POST') {
          seen.posts++;
          return route.fulfill({ contentType: 'application/json', body: '{}' });
        }
        const body = pathname === '/embed/job_app/confirmation' ? greenhouseConfirmationHtml : html;
        return route.fulfill({ contentType: 'text/html', body });
      });
      page = await context.newPage();
      return page;
    };
  return { api, open, seen, page: () => page! };
}

const valueOf = (check: FormCheckRequest, key: string) =>
  check.fields.find((f) => f.key === key)?.value;

const quiet = { log: () => undefined, signal: new AbortController().signal, pollMs: 20 };

/**
 * The user picks the phone number's country in the window: a required field the app has no
 * answer for, without which the browser does not let the form be submitted.
 */
const pickCountry = async (_check: FormCheckRequest, page: Page) => {
  await page
    .locator('.select__container', { has: page.locator('#country') })
    .locator('.select__control')
    .click();
  await page.locator('#country').fill('Finland');
  await page.locator('#react-select-country-option-0').click();
};

describe(
  'filling in Greenhouse’s form',
  { skip: chrome ? false : 'Google Chrome is not installed' },
  () => {
    let browser: Browser;
    before(() => {
      browser = chrome!;
    });
    after(() => browser?.close());

    test('puts in every answer, attaches the PDF, never submits, and closes when the fill ends', async () => {
      const app = fakeApp({ afterChecks: ['filled'], polls: ['filled', 'closed'] });
      const lines: string[] = [];
      await runTask(task(), {
        ...quiet,
        api: app.api,
        open: app.open(),
        log: (l) => lines.push(l),
      });
      assert.deepEqual(app.seen.files, [pdfId]);
      assert.equal(app.seen.checks.length, 1);
      const [check] = app.seen.checks;
      assert.equal(check!.filledNow, true);
      assert.equal(check!.blocker, null);
      assert.deepEqual(
        check!.fields.map((f) => [f.key, f.value]),
        [
          ['first_name', ['Test']],
          ['last_name', ['Person']],
          ['email', ['test.person@example.com']],
          // Not one of the app's questions: the user picks it.
          ['country', []],
          ['phone', ['+358 40 000 0000']],
          ['resume', ['Test Person - Resume.pdf']],
          ['cover_letter', []],
          // The exact option, not the first that contains the words.
          ['location', ['Helsinki']],
          ['question_101', ['https://example.com/in/test']],
          ['question_102', ['No']],
          ['question_103', ['One month']],
          ['question_104[]', ['Finland', 'Estonia']],
          ['question_105[]', ['English', 'Finnish']],
          ['gender', []],
          ['demographic_4001', ['Yes']],
          ['gdpr_processing_consent_given', ['checked']],
        ],
      );
      assert.equal(
        Buffer.from(check!.screenshot, 'base64').subarray(0, 4).toString('latin1'),
        '\x89PNG',
      );
      assert.deepEqual(app.seen.submitted, [null]);
      assert.deepEqual(lines, [
        'Filled in and stopped before Submit. Now filled.',
        'The fill was closed in the app; its window closes.',
      ]);
      assert.ok(app.page().isClosed());
    });

    test('an answer the form does not take is left for the user to see', async () => {
      const app = fakeApp({ afterChecks: ['paused'], polls: ['closed'] });
      const lines: string[] = [];
      const wrong = fields.map((f) => (f.key === 'question_102' ? { ...f, answer: ['Maybe'] } : f));
      await runTask(task({ fields: wrong }), {
        ...quiet,
        api: app.api,
        open: app.open(),
        log: (l) => lines.push(l),
      });
      assert.deepEqual(valueOf(app.seen.checks[0]!, 'question_102'), []);
      assert.match(lines[0]!, /^ {2}Could not fill in Visa\?: /);
      assert.deepEqual(app.seen.submitted, [null]);
    });

    test('after the user acts in the window and continues, the runner looks again without filling', async () => {
      const app = fakeApp({
        afterChecks: ['paused', 'filled'],
        polls: ['paused', 'filling', 'filled', 'closed'],
        // The user changes the first name in the window.
        onCheck: async (check, page) => {
          if (check.filledNow) await page.locator('#first_name').fill('Changed');
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open() });
      assert.deepEqual(
        app.seen.checks.map((c) => [c.filledNow, valueOf(c, 'first_name')]),
        [
          [true, ['Test']],
          [false, ['Changed']],
        ],
      );
    });

    test('a CAPTCHA is left to the user; the form is filled after they continue', async () => {
      const captcha = greenhouseFormHtml.replace(
        '<form ',
        '<iframe id="challenge" title="recaptcha challenge expires in two minutes" src="about:blank"></iframe><form ',
      );
      const app = fakeApp({
        afterChecks: ['paused', 'filled'],
        polls: ['filling', 'closed'],
        onCheck: async (check, page) => {
          if (check.blocker)
            await page.evaluate(() => document.getElementById('challenge')!.remove());
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open(captcha) });
      assert.deepEqual(
        app.seen.checks.map((c) => [c.blocker, c.filledNow, valueOf(c, 'first_name')]),
        [
          ['captcha', false, ['']],
          [null, true, ['Test']],
        ],
      );
    });

    test('the user closing the window ends the fill', async () => {
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: Array(1000).fill('filled'),
        onCheck: async (_check, page) => {
          setTimeout(() => void page.close(), 50);
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open() });
      assert.equal(app.seen.windowClosed, 1);
      assert.deepEqual(app.seen.failures, []);
    });

    test('a page without the form fails the fill', async () => {
      const app = fakeApp({ afterChecks: [], polls: [] });
      await runTask(task(), {
        ...quiet,
        api: app.api,
        open: app.open('<p>This job is no longer open.</p>'),
        formWaitMs: 100,
      });
      assert.deepEqual(app.seen.failures, ['The page shows no Greenhouse application form.']);
      assert.ok(app.page().isClosed());
    });

    test('a form whose script never takes it over is not filled', async () => {
      const app = fakeApp({ afterChecks: [], polls: [] });
      const dead = greenhouseFormHtml.replace(/<script>[\s\S]*<\/script>/, '');
      await runTask(task(), { ...quiet, api: app.api, open: app.open(dead), formWaitMs: 300 });
      assert.deepEqual(app.seen.failures, ['The form did not start working in the page.']);
      assert.deepEqual(app.seen.checks, []);
    });

    test('approved: one look before Submit, Submit pressed once, the confirmation page', async () => {
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: ['approved'],
        goes: [true],
        onCheck: pickCountry,
      });
      const lines: string[] = [];
      await runTask(task(), {
        ...quiet,
        api: app.api,
        open: app.open(),
        log: (l) => lines.push(l),
      });
      assert.equal(app.seen.beforeSubmit.length, 1);
      const [look] = app.seen.beforeSubmit;
      assert.equal(look!.filledNow, false);
      assert.deepEqual(valueOf(look!, 'first_name'), ['Test']);
      assert.deepEqual(valueOf(look!, 'resume'), ['Test Person - Resume.pdf']);
      assert.equal(app.seen.posts, 1);
      assert.equal(app.seen.results.length, 1);
      const [result] = app.seen.results;
      assert.deepEqual(
        { ...result!, screenshot: result!.screenshot?.slice(0, 8) },
        {
          confirmation: true,
          pageUrl:
            'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=example&token=7',
          pageText: 'Thank you for applying to Example Oy! View more jobs at Example Oy',
          note: '',
          screenshot: 'iVBORw0K',
        },
      );
      assert.deepEqual(lines.slice(1), ['Pressing Submit, once.', 'Submitted. Now submitted.']);
      assert.ok(app.page().isClosed());
    });

    test('approved, but the app does not let it press Submit: nothing is sent', async () => {
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: ['approved', 'filled', 'closed'],
        goes: [false],
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open() });
      assert.equal(app.seen.beforeSubmit.length, 1);
      assert.equal(app.seen.posts, 0);
      assert.deepEqual(app.seen.results, []);
    });

    test('an emailed security code is the user’s to type; the runner never presses Submit again', async () => {
      const html = greenhouseFormHtml.replace('<body>', '<body data-after-submit="security-code">');
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: ['approved'],
        goes: [true],
        onCheck: pickCountry,
        // The user types the code and presses Submit in the window.
        onProgress: async (shows, page) => {
          if (shows !== 'security_code') return;
          for (let i = 0; i < 8; i++) await page.locator(`#security-input-${i}`).fill(String(i));
          await page.getByRole('button', { name: 'Submit application' }).click();
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open(html) });
      assert.deepEqual(app.seen.progress, ['security_code']);
      // The runner's Submit and the user's.
      assert.equal(app.seen.posts, 2);
      assert.equal(app.seen.results[0]!.confirmation, true);
    });

    test('no confirmation page in time: the result is unknown, and Submit was pressed once', async () => {
      const html = greenhouseFormHtml.replace('<body>', '<body data-after-submit="nothing">');
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: ['approved'],
        goes: [true],
        onCheck: pickCountry,
      });
      await runTask(task(), {
        ...quiet,
        api: app.api,
        open: app.open(html),
        submitWaitMs: 1500,
      });
      assert.equal(app.seen.posts, 1);
      const [result] = app.seen.results;
      assert.equal(result!.confirmation, false);
      assert.equal(result!.note, 'Greenhouse’s confirmation page did not show within 1.5 seconds.');
      assert.equal(result!.pageUrl, url);
      assert.match(result!.screenshot!, /^iVBORw0K/);
    });

    test('the window closed after Submit: the result is unknown', async () => {
      const html = greenhouseFormHtml.replace('<body>', '<body data-after-submit="security-code">');
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: ['approved'],
        goes: [true],
        onCheck: pickCountry,
        onProgress: async (_shows, page) => {
          setTimeout(() => void page.close(), 20);
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open(html) });
      assert.deepEqual(app.seen.results, [
        {
          confirmation: false,
          pageUrl: null,
          pageText: '',
          note: 'The window was closed before Greenhouse’s confirmation page showed.',
          screenshot: null,
        },
      ]);
      assert.equal(app.seen.windowClosed, 0);
    });

    test('stopping the runner closes the window and leaves the fill to the app', async () => {
      const stop = new AbortController();
      const app = fakeApp({
        afterChecks: ['filled'],
        polls: Array(1000).fill('filled'),
        onCheck: async () => {
          setTimeout(() => stop.abort(), 50);
        },
      });
      await runTask(task(), { ...quiet, api: app.api, open: app.open(), signal: stop.signal });
      assert.ok(app.page().isClosed());
      assert.equal(app.seen.windowClosed, 0);
    });
  },
);

describe('the runner’s loop', () => {
  test('refuses a page other than Greenhouse’s form, and stops when its token is refused', async () => {
    const asked: string[] = [];
    let claims = 0;
    const api = {
      async reset() {
        asked.push('reset');
      },
      async claim() {
        claims++;
        if (claims === 1) return task({ url: 'https://careers.example.com/jobs/7' });
        throw new Unauthorized('The app refused the runner’s token.');
      },
      async fail(_id: string, message: string) {
        asked.push(`fail: ${message}`);
        return { status: 'failed' as const, message };
      },
    } as unknown as RunnerApi;
    const lines: string[] = [];
    await assert.rejects(
      runRunner({
        api,
        launch: () => Promise.reject(new Error('no browser in this test')),
        log: (l) => lines.push(l),
        signal: new AbortController().signal,
        pollMs: 10,
      }),
      Unauthorized,
    );
    assert.deepEqual(asked, [
      'reset',
      'fail: The runner fills only Greenhouse’s application forms.',
      'reset',
    ]);
    assert.match(lines[0]!, /Not filling “Platform Engineer” at Example Oy/);
  });
});
