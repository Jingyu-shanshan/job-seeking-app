import type { RunnerTask } from '@jsa/shared';
import type { Browser, Page } from 'playwright-core';
import { type RunnerApi, Unauthorized } from './api.ts';
import { isGreenhouseForm } from './greenhouse.ts';
import { runTask } from './task.ts';

// The runner's loop (T17): ask the app for a fill the user started, fill it, and follow it until
// it ends, one fill at a time. The browser starts with the first fill and each fill gets a window
// of its own, in a new profile that keeps nothing: no cookies, logins or passwords stay.

export interface RunnerOptions {
  api: RunnerApi;
  /** Starts the browser, whose windows the user sees. */
  launch: () => Promise<Browser>;
  log: (line: string) => void;
  /** Stops the runner: it closes its windows and tells the app. */
  signal: AbortSignal;
  pollMs?: number;
  taskPollMs?: number;
}

const firstLine = (error: unknown) =>
  String((error as Error)?.message ?? error).split('\n', 1)[0] ?? '';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

export async function runRunner({
  api,
  launch,
  log,
  signal,
  pollMs = 3000,
  taskPollMs = 2000,
}: RunnerOptions): Promise<void> {
  await api.reset();
  let browser: Browser | undefined;
  const open = async (): Promise<Page> => {
    if (!browser?.isConnected()) browser = await launch();
    const context = await browser.newContext({ viewport: null, acceptDownloads: false });
    return context.newPage();
  };
  let unreachable = false;
  try {
    while (!signal.aborted) {
      let task: RunnerTask | null = null;
      try {
        task = await api.claim();
        if (unreachable) log('The app answers again.');
        unreachable = false;
      } catch (error) {
        if (error instanceof Unauthorized) throw error;
        if (!unreachable) log(`Could not reach the app (${firstLine(error)}); trying again.`);
        unreachable = true;
      }
      if (!task) {
        await sleep(pollMs, signal);
        continue;
      }
      const what = `“${task.title}”${task.company ? ` at ${task.company}` : ''}`;
      if (!isGreenhouseForm(task.url)) {
        log(`Not filling ${what}: the runner fills only Greenhouse’s application forms.`);
        await api.fail(task.id, 'The runner fills only Greenhouse’s application forms.');
        continue;
      }
      log(`Filling in the form for ${what}.`);
      try {
        await runTask(task, { api, open, log, signal, pollMs: taskPollMs });
      } catch (error) {
        if (error instanceof Unauthorized) throw error;
        log(`Could not fill in the form for ${what}: ${firstLine(error)}`);
        await api.fail(task.id, firstLine(error)).catch(() => undefined);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await api.reset().catch(() => undefined);
  }
}
