import type { ToolbarBridge, ToolbarState } from '../toolbar-state.ts';

declare global {
  interface Window {
    desktop: ToolbarBridge;
  }
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = element<HTMLFormElement>('address-form');
const address = element<HTMLInputElement>('address');
const back = element<HTMLButtonElement>('back');
const forward = element<HTMLButtonElement>('forward');
const reload = element<HTMLButtonElement>('reload');
const saveJob = element<HTMLButtonElement>('save-job');
const saveResults = element<HTMLButtonElement>('save-results');
const status = element<HTMLParagraphElement>('status');
const statusText = element<HTMLSpanElement>('status-text');
const statusAction = element<HTMLButtonElement>('status-action');

let loading = false;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  window.desktop.navigate(address.value);
  address.blur();
});
back.addEventListener('click', () => window.desktop.back());
forward.addEventListener('click', () => window.desktop.forward());
reload.addEventListener('click', () => (loading ? window.desktop.stop() : window.desktop.reload()));
saveJob.addEventListener('click', () => window.desktop.saveJob());
saveResults.addEventListener('click', () => window.desktop.saveResults());
statusAction.addEventListener('click', () => window.desktop.runAction());

window.desktop.onState((state: ToolbarState) => {
  loading = state.loading;
  // What the user is typing stays until they press Enter or leave the bar.
  if (document.activeElement !== address) address.value = state.url;
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  reload.textContent = state.loading ? '✕' : '↻';
  reload.ariaLabel = reload.title = state.loading ? 'Stop' : 'Reload';
  reload.disabled = state.url === '';
  saveJob.disabled = state.busy || state.url === '';
  saveResults.hidden = !state.canSaveResults;
  saveResults.disabled = state.busy;
  status.dataset['tone'] = state.status.tone;
  statusText.textContent = state.status.text;
  statusText.title = state.status.text;
  statusAction.hidden = state.status.action === null;
  statusAction.textContent = state.status.action ?? '';
});
