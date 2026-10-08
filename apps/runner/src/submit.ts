import type { RunnerTask, RunnerTaskState, SubmitProgress } from '@jsa/shared';
import type { Page } from 'playwright-core';
import type { RunnerApi } from './api.ts';
import { lookAt, pageScreenshot, submitButton } from './greenhouse.ts';
import { findBlocker, readAfterSubmit } from './page-readers.ts';

// Submitting a form the user approved (T18). The runner reads the form once more and sends that
// look to the app, which lets it press Submit only when the approval still holds and the form has
// the approved values. It then presses Submit once, and never again: what the page asks for next
// (a CAPTCHA, an emailed security code, a field it did not accept) is the user's to do in the
// window. The runner watches for Greenhouse's confirmation page and sends what it saw; anything
// else, after 10 minutes, is a result the user verifies.

export interface SubmitOptions {
  api: Pick<RunnerApi, 'submit' | 'progress' | 'result' | 'fail'>;
  log: (line: string) => void;
  /** The runner is stopping. */
  signal: AbortSignal;
  /** How long the runner watches for the confirmation page after pressing Submit. */
  waitMs?: number;
  pollMs?: number;
}

const firstLine = (error: unknown) =>
  String((error as Error)?.message ?? error).split('\n', 1)[0] ?? '';

const progressWords: Record<SubmitProgress, string> = {
  captcha: 'The page asks you to prove you are not a robot; do it in the window.',
  security_code: 'Greenhouse asks for the security code it emailed you; type it in the window.',
  form_errors: 'The form shows fields it did not accept; fix them in the window.',
  other: 'Waiting for Greenhouse’s confirmation page.',
};

/** Submits the approved form in `page` if the app lets it, and returns where the fill is then. */
export async function submitApproved(
  page: Page,
  task: RunnerTask,
  { api, log, signal, waitMs = 10 * 60_000, pollMs = 1000 }: SubmitOptions,
): Promise<RunnerTaskState> {
  const button = submitButton(page);
  if ((await button.count()) !== 1 || !(await button.isVisible())) {
    return api.fail(task.id, 'The page shows no Submit button for the application form.');
  }
  const look = await lookAt(page);
  const { go, state } = await api.submit(task.id, {
    filledNow: false,
    blocker: look.blocker,
    fields: look.fields ?? [],
    screenshot: look.screenshot.toString('base64'),
  });
  if (!go) {
    log(state.message);
    return state;
  }

  log('Pressing Submit, once.');
  const screenshot = async () =>
    page.isClosed()
      ? null
      : ((await pageScreenshot(page).catch(() => null))?.toString('base64') ?? null);
  const unknown = async (note: string) =>
    api.result(task.id, {
      confirmation: false,
      pageUrl: page.isClosed() ? null : page.url(),
      pageText: page.isClosed()
        ? ''
        : ((await page.evaluate(readAfterSubmit).catch(() => null))?.text ?? ''),
      note,
      screenshot: await screenshot(),
    });
  try {
    await button.click({ timeout: 10_000 });
  } catch (error) {
    // Whether the click reached the page is not known: the user verifies.
    return unknown(`Pressing Submit failed (${firstLine(error)}).`);
  }

  const deadline = Date.now() + waitMs;
  let shown: SubmitProgress = 'other';
  for (;;) {
    if (page.isClosed()) {
      return unknown('The window was closed before Greenhouse’s confirmation page showed.');
    }
    if (signal.aborted) {
      return unknown('The runner was stopped before Greenhouse’s confirmation page showed.');
    }
    // While the page moves to the next one, it cannot be read: the next round reads it.
    const now = await page.evaluate(readAfterSubmit).catch(() => null);
    if (now?.confirmation) {
      return api.result(task.id, {
        confirmation: true,
        pageUrl: page.url(),
        pageText: now.text,
        note: '',
        screenshot: await screenshot(),
      });
    }
    if (now) {
      const blocker = await page.evaluate(findBlocker).catch(() => null);
      const shows: SubmitProgress =
        blocker === 'captcha'
          ? 'captcha'
          : now.securityCode
            ? 'security_code'
            : now.formErrors
              ? 'form_errors'
              : 'other';
      if (shows !== shown) {
        shown = shows;
        log(progressWords[shows]);
        await api
          .progress(task.id, shows)
          .catch((error) => log(`Could not tell the app (${firstLine(error)}).`));
      }
    }
    if (Date.now() >= deadline) {
      const within =
        waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} minutes` : `${waitMs / 1000} seconds`;
      return unknown(`Greenhouse’s confirmation page did not show within ${within}.`);
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), {
        once: true,
      });
    });
  }
}
