import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolbarState } from '../toolbar-state.ts';

test('toolbar preserves typing, exposes saving and error recovery, and sends only explicit commands', async (t) => {
  const dom = new JSDOM(await readFile(new URL('./index.html', import.meta.url), 'utf8'));
  const commands: string[] = [];
  let receive!: (state: ToolbarState) => void;
  Object.assign(dom.window, {
    desktop: {
      navigate: (url: string) => commands.push(url),
      back: () => commands.push('back'),
      forward: () => commands.push('forward'),
      reload: () => commands.push('reload'),
      stop: () => commands.push('stop'),
      saveJob: () => commands.push('save-job'),
      saveResults: () => commands.push('save-results'),
      runAction: () => commands.push('action'),
      onState: (listener: typeof receive) => (receive = listener),
    },
  });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    dom.window.close();
  });
  await import('./toolbar.ts');
  const document = dom.window.document;
  const address = document.querySelector<HTMLInputElement>('#address')!;
  const save = document.querySelector<HTMLButtonElement>('#save-job')!;
  const results = document.querySelector<HTMLButtonElement>('#save-results')!;
  const action = document.querySelector<HTMLButtonElement>('#status-action')!;
  const state: ToolbarState = {
    url: 'https://example.test/jobs/1',
    canGoBack: false,
    canGoForward: true,
    loading: false,
    canSaveResults: false,
    busy: false,
    status: { tone: 'info', text: 'Browse a job site yourself.', action: null },
  };
  receive(state);
  assert.equal(results.hidden, true);
  assert.equal(action.hidden, true);
  assert.equal(save.disabled, false);
  address.focus();
  address.value = 'example.test/typed';
  receive({ ...state, busy: true, canSaveResults: true });
  assert.equal(address.value, 'example.test/typed');
  assert.equal(save.textContent, 'Saving…');
  assert.equal(save.disabled, true);
  assert.equal(results.disabled, true);
  assert.deepEqual(commands, []);
  const message = 'Could not save this page. ' + 'Long visible explanation. '.repeat(40);
  receive({ ...state, status: { tone: 'error', text: message, action: 'Sign in' } });
  assert.equal(document.querySelector('#status-text')!.textContent, message);
  assert.equal(document.querySelector('#status')!.getAttribute('data-tone'), 'error');
  assert.equal(action.hidden, false);
  action.click();
  save.click();
  document
    .querySelector('form')!
    .dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.deepEqual(commands, ['action', 'save-job', 'example.test/typed']);
});
