import type { RunnerTask, RunnerTaskState } from '@jsa/shared';
import type { Page } from 'playwright-core';
import { type RunnerApi, Unauthorized } from './api.ts';
import { fillGreenhouseForm, lookAt } from './greenhouse.ts';
import { formIsLive } from './page-readers.ts';

// One fill (T17): open the form in a new window, fill in the runner's answers once, and send the
// app a look at the form. The app decides whether the fill pauses for the user or is filled in;
// the runner then waits for the user, who acts in the window and presses Continue in the app, or
// closes the fill. The window stays open until the fill ends. Nothing is ever submitted.

export interface TaskOptions {
  api: Pick<RunnerApi, 'state' | 'file' | 'check' | 'fail' | 'windowClosed'>;
  /** Opens a new browser window. */
  open: () => Promise<Page>;
  log: (line: string) => void;
  /** Stops following the fill, and closes its window. */
  signal: AbortSignal;
  pollMs?: number;
  /** How long the page may take to show its form. */
  formWaitMs?: number;
}

/** What the runner's log says before the app's message. */
const statusWords: Partial<Record<RunnerTaskState['status'], string>> = {
  paused: 'Paused. ',
  filled: 'Filled in and stopped before Submit. ',
};

const firstLine = (error: unknown) =>
  String((error as Error)?.message ?? error).split('\n', 1)[0] ?? '';

/** Fills the form of `task` and follows the fill until it ends, its window closes or `signal`. */
export async function runTask(
  task: RunnerTask,
  { api, open, log, signal, pollMs = 2000, formWaitMs = 15_000 }: TaskOptions,
): Promise<void> {
  const files = new Map<string, Buffer>();
  for (const field of task.fields) {
    if (field.documentPdfId && field.answer.length) {
      files.set(field.key, await api.file(task.id, field.documentPdfId));
    }
  }
  const page = await open();
  const windowClosed = new Promise<'closed'>((resolve) =>
    page.once('close', () => resolve('closed')),
  );
  const stopped = new Promise<'stopped'>((resolve) => {
    if (signal.aborted) resolve('stopped');
    signal.addEventListener('abort', () => resolve('stopped'), { once: true });
  });

  /** Waits while the user has the window: until they continue or close the fill. */
  async function waitForUser(
    state: RunnerTaskState,
  ): Promise<RunnerTaskState | 'closed' | 'stopped'> {
    while (state.status === 'paused' || state.status === 'filled') {
      const tick = new Promise<'tick'>((resolve) => setTimeout(resolve, pollMs, 'tick'));
      const woke = await Promise.race([tick, windowClosed, stopped]);
      if (woke !== 'tick') return woke;
      try {
        state = await api.state(task.id);
      } catch (error) {
        if (error instanceof Unauthorized) throw error;
        log(`Could not reach the app (${firstLine(error)}); trying again.`);
      }
    }
    return state;
  }

  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    let filled = false;
    let state: RunnerTaskState = { status: 'filling', message: '' };
    while (state.status === 'filling') {
      // The page's script takes the form over a moment after it shows; filled or looked at before
      // that, the form would lose what the runner put in or change under the screenshot. A page
      // with a CAPTCHA in front of the form never gets that far, so neither wait is required.
      const form = page.locator('form#application-form');
      const shown = await form
        .waitFor({ timeout: formWaitMs })
        .then(() => true)
        .catch(() => false);
      const live =
        shown &&
        (await page
          .waitForFunction(formIsLive, undefined, { timeout: formWaitMs })
          .then(() => true)
          .catch(() => false));
      // Greenhouse's file upload works only once the page has loaded the rest of its scripts.
      if (live && !filled) {
        await page.waitForLoadState('networkidle', { timeout: formWaitMs }).catch(() => undefined);
      }
      let look = await lookAt(page);
      let filledNow = false;
      if (!look.blocker && !filled) {
        if (!look.fields) {
          await api.fail(task.id, 'The page shows no Greenhouse application form.');
          return;
        }
        if (!live) {
          await api.fail(task.id, 'The form did not start working in the page.');
          return;
        }
        for (const failure of await fillGreenhouseForm(page, task.fields, files)) {
          log(`  Could not fill in ${failure}`);
        }
        filled = filledNow = true;
        look = await lookAt(page);
      }
      state = await api.check(task.id, {
        filledNow,
        blocker: look.blocker,
        fields: look.fields ?? [],
        screenshot: look.screenshot.toString('base64'),
      });
      log(`${statusWords[state.status] ?? ''}${state.message}`);
      const next = await waitForUser(state);
      if (next === 'stopped') return;
      if (next === 'closed') {
        log('The window was closed.');
        await api.windowClosed(task.id);
        return;
      }
      state = next;
    }
    if (state.status === 'closed') log('The fill was closed in the app; its window closes.');
  } catch (error) {
    if (error instanceof Unauthorized) throw error;
    if (page.isClosed()) {
      log('The window was closed.');
      await api.windowClosed(task.id);
      return;
    }
    log(`Could not go on: ${firstLine(error)}`);
    await api.fail(task.id, firstLine(error));
  } finally {
    if (!page.isClosed()) await page.context().close();
  }
}
