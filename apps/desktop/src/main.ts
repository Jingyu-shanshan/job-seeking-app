import { join } from 'node:path';
import type { SavePageResponse, SaveResultsResponse } from '@jsa/shared';
import { BaseWindow, WebContentsView, app, dialog, ipcMain, session } from 'electron';
import { addressToUrl, isWebAddress } from './address.ts';
import { postToApp } from './app-api.ts';
import { appUrlFrom } from './config.ts';
import { readJobPage, readLinkedInResults } from './readers.ts';
import {
  jobPageRequest,
  pageSavedMessage,
  resultsRequest,
  resultsSavedMessage,
  siteOf,
} from './saving.ts';
import type { ToolbarState } from './toolbar-state.ts';

// The desktop app (T21): the app's own pages on the left, and on the right a built-in browser in
// which the user browses job sites themselves, with a toolbar to save the page they are looking at.
//
// The app never opens, clicks, scrolls or types on a third-party page by itself. It reads a page
// only when the user presses a save button, once per press, and it never runs in the background:
// it quits when its window closes. Third-party pages run sandboxed, with context isolation and
// without any preload, in a session of their own, so their cookies and logins stay on this
// computer. Only what a reader read goes to the app's server, through the app pane's session.

/** An isolated world for the readers. 0 is the page's own; Electron uses 999 for preloads. */
const readerWorld = 1001;
const readTimeoutMs = 10_000;
const toolbarHeight = 96;

const intro =
  'Browse a job site here yourself. On a job’s page, press Save this job. The app opens, clicks and scrolls nothing by itself.';

const appUrl = loadAppUrl();

function loadAppUrl(): URL {
  try {
    return appUrlFrom(process.env);
  } catch (error) {
    dialog.showErrorBox('The app’s address is not valid', (error as Error).message);
    app.exit(1);
    throw error;
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// One window and one set of sessions: a second start brings the first window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(createWindow, (error: unknown) => {
    dialog.showErrorBox('The desktop app could not start', String(error));
    app.exit(1);
  });
}

function createWindow() {
  const appSession = session.fromPartition('persist:app');
  const browseSession = session.fromPartition('persist:browse');
  for (const s of [appSession, browseSession]) {
    s.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    s.setPermissionCheckHandler(() => false);
  }

  const isolated = { sandbox: true, contextIsolation: true, nodeIntegration: false } as const;
  const window = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: app.getName(),
    backgroundColor: '#808080',
  });
  const appView = new WebContentsView({ webPreferences: { ...isolated, session: appSession } });
  const toolbarView = new WebContentsView({
    webPreferences: {
      ...isolated,
      partition: 'toolbar',
      preload: join(import.meta.dirname, 'toolbar/preload.cjs'),
    },
  });
  const browserView = new WebContentsView({
    webPreferences: { ...isolated, session: browseSession, webviewTag: false },
  });
  for (const view of [appView, toolbarView, browserView]) window.contentView.addChildView(view);
  const appPage = appView.webContents;
  const toolbar = toolbarView.webContents;
  const browser = browserView.webContents;

  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  const layout = () => {
    const { width, height } = window.getContentBounds();
    const left = Math.max(360, Math.min(Math.round(width * 0.42), width - 480));
    const right = { x: left + 1, width: width - left - 1 };
    appView.setBounds({ x: 0, y: 0, width: left, height });
    toolbarView.setBounds({ ...right, y: 0, height: toolbarHeight });
    browserView.setBounds({ ...right, y: toolbarHeight, height: height - toolbarHeight });
  };
  window.on('resize', layout);
  layout();

  // The toolbar's state.
  let busy = false;
  let status: ToolbarState['status'] = { text: intro, tone: 'info', action: null };
  let action: (() => void) | null = null;

  const sendState = () => {
    if (toolbar.isDestroyed() || browser.isDestroyed()) return;
    const url = browser.getURL();
    const history = browser.navigationHistory;
    const state: ToolbarState = {
      url: url === 'about:blank' ? '' : url,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      loading: browser.isLoading(),
      canSaveResults: siteOf(url) === 'linkedin',
      busy,
      status,
    };
    toolbar.send('toolbar-state', state);
  };
  const setStatus = (
    text: string,
    tone: ToolbarState['status']['tone'] = 'info',
    next?: { label: string; run: () => void },
  ) => {
    status = { text, tone, action: next?.label ?? null };
    action = next?.run ?? null;
    sendState();
  };

  // Opens a page in the built-in browser. Only ever called for something the user did: typed an
  // address, clicked a link in the app, or pressed "Open it here".
  const openInBrowser = (url: string) => {
    if (!isWebAddress(url)) return;
    browser.loadURL(url).catch(() => {
      // did-fail-load says why.
    });
  };
  const openInApp = (path: string) => {
    appPage.loadURL(new URL(path, appUrl).href).catch(() => {
      // did-fail-load says why.
    });
  };

  // The app pane shows the app's own pages only; a link to anywhere else opens on the right.
  appPage.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  appPage.on('will-navigate', (event) => {
    if (new URL(event.url).origin === appUrl.origin) return;
    event.preventDefault();
    openInBrowser(event.url);
  });
  appPage.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is a load the user or the app cut short by starting another.
    if (!isMainFrame || code === -3 || !url.startsWith(appUrl.origin)) return;
    setStatus(
      `The app at ${appUrl.origin} is not reachable (${description}). Start it with npm start, then retry.`,
      'error',
      { label: 'Retry', run: () => openInApp('/') },
    );
  });

  // The built-in browser: no new windows, downloads or permissions, web pages only, and a page
  // cannot stop the app from closing or the user from leaving it.
  browser.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      setStatus(`This page wants to open ${new URL(url).hostname} in a new window.`, 'info', {
        label: 'Open it here',
        run: () => openInBrowser(url),
      });
    }
    return { action: 'deny' };
  });
  // Opening other apps (mailto:, custom schemes) also needs a permission, which is refused above.
  const webOnly = (event: { url: string; preventDefault(): void }) => {
    if (!isWebAddress(event.url)) event.preventDefault();
  };
  browser.on('will-frame-navigate', webOnly);
  browser.on('will-redirect', webOnly);
  browser.on('will-prevent-unload', (event) => event.preventDefault());
  browseSession.on('will-download', (event) => {
    event.preventDefault();
    setStatus('Downloads are turned off in the built-in browser.');
  });
  browser.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    setStatus(`${url} could not be opened: ${description}.`, 'error');
  });
  browser.on('did-start-loading', sendState);
  browser.on('did-stop-loading', sendState);
  browser.on('did-navigate', sendState);
  browser.on('did-navigate-in-page', sendState);

  // The toolbar never navigates or opens anything itself.
  toolbar.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.on('will-navigate', (event) => event.preventDefault());
  toolbar.on('did-finish-load', sendState);

  /** Runs a reader in the page, once. The page must still be the one the user saved. */
  async function read(url: string, code: string): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), readTimeoutMs);
    });
    try {
      // Runs once the page has stopped loading; a page that does not stop is not waited for.
      const reading: unknown = await Promise.race([
        browser.executeJavaScriptInIsolatedWorld(readerWorld, [{ code }]),
        timeout,
      ]);
      if (browser.getURL() !== url) throw new Error('changed');
      return reading;
    } finally {
      clearTimeout(timer);
    }
  }

  function readFailure(error: unknown) {
    const reason = (error as Error).message;
    if (reason === 'timeout') return 'The page is still loading. Save again once it has loaded.';
    if (reason === 'changed') return 'The page changed while it was read. Save again.';
    return 'The page could not be read.';
  }

  async function save(work: (url: string) => Promise<void>) {
    const url = browser.getURL();
    if (busy) return;
    if (!url.startsWith('https://')) {
      setStatus('Open a job’s page over https first.', 'error');
      return;
    }
    busy = true;
    setStatus('Reading the page…');
    try {
      await work(url);
    } catch (error) {
      setStatus(readFailure(error), 'error');
    } finally {
      busy = false;
      sendState();
    }
  }

  const saveJob = () =>
    save(async (url) => {
      const reading = await read(url, `(${readJobPage})(${JSON.stringify(siteOf(url))})`);
      const saving = jobPageRequest(url, reading);
      if ('error' in saving) return setStatus(saving.error, 'error');
      setStatus('Saving…');
      const answer = await postToApp<SavePageResponse>(
        appFetch,
        appUrl,
        '/api/saved-pages',
        saving.request,
      );
      if (!answer.ok) return setStatus(answer.message, 'error');
      setStatus(pageSavedMessage(answer.value, saving.saved), 'success', {
        label: 'Open in the app',
        run: () => openInApp(`/jobs/${answer.value.jobId}`),
      });
    });

  const saveResults = () =>
    save(async (url) => {
      if (siteOf(url) !== 'linkedin') {
        return setStatus('Saving a results page works on LinkedIn only.', 'error');
      }
      const saving = resultsRequest(await read(url, `(${readLinkedInResults})()`));
      if ('error' in saving) return setStatus(saving.error, 'error');
      setStatus(`Saving ${saving.saved}…`);
      const answer = await postToApp<SaveResultsResponse>(
        appFetch,
        appUrl,
        '/api/saved-results',
        saving.request,
      );
      if (!answer.ok) return setStatus(answer.message, 'error');
      setStatus(resultsSavedMessage(answer.value, saving.unreadable), 'success', {
        label: 'Open the job list',
        run: () => openInApp('/jobs'),
      });
    });

  // Requests to the app carry the app pane's session cookie and nothing of the built-in browser's.
  const appFetch: typeof globalThis.fetch = (input, init) =>
    appSession.fetch(input instanceof URL ? input.href : input, init);

  ipcMain.on('toolbar', (event, command: unknown, arg: unknown) => {
    if (event.sender !== toolbar) return;
    const history = browser.navigationHistory;
    switch (command) {
      case 'navigate': {
        const url = typeof arg === 'string' ? addressToUrl(arg) : null;
        if (url) openInBrowser(url);
        else setStatus('Type a web address, such as linkedin.com/jobs.', 'error');
        break;
      }
      case 'back':
        if (history.canGoBack()) history.goBack();
        break;
      case 'forward':
        if (history.canGoForward()) history.goForward();
        break;
      case 'reload':
        if (browser.getURL() !== 'about:blank') browser.reload();
        break;
      case 'stop':
        browser.stop();
        break;
      case 'save-job':
        void saveJob();
        break;
      case 'save-results':
        void saveResults();
        break;
      case 'action':
        action?.();
        break;
    }
  });

  toolbar.loadFile(join(import.meta.dirname, 'toolbar/index.html')).catch(() => {
    dialog.showErrorBox('The desktop app could not start', 'The toolbar could not be loaded.');
  });
  openInApp('/');
}
