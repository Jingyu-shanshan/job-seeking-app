import { chromium } from 'playwright-core';
import { runnerApi } from './api.ts';
import { runnerConfig } from './config.ts';
import { runRunner } from './runner.ts';

// The local runner (T17): `npm run runner`. It fills the application forms the user starts in the
// app, in Google Chrome windows the user sees, and stops before Submit. It never solves CAPTCHAs,
// never hides that it is automated, and keeps no third-party passwords.

let config;
try {
  config = runnerConfig(process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

const log = (line: string) => console.log(`${new Date().toLocaleTimeString()}  ${line}`);

log(
  `The runner fills the forms you start in the app at ${config.appUrl.origin}, in Chrome windows you can see, and stops before Submit. Press Ctrl+C to stop.`,
);
try {
  await runRunner({
    api: runnerApi(config.appUrl, config.token),
    launch: async () => {
      try {
        // Chrome's own sandbox stays on: the windows show other sites' pages (Playwright turns it
        // off unless asked). Ctrl+C is the runner's: Playwright would exit before the runner
        // tells the app its windows are gone.
        return await chromium.launch({
          channel: 'chrome',
          headless: false,
          chromiumSandbox: true,
          handleSIGINT: false,
          handleSIGTERM: false,
        });
      } catch (error) {
        const why = (error as Error).message.split('\n', 1)[0];
        throw new Error(`Google Chrome could not be started (${why}). Is it installed?`, {
          cause: error,
        });
      }
    },
    log,
    signal: controller.signal,
  });
  log('Stopped.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
