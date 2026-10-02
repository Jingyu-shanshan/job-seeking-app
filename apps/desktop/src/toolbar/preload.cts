// The toolbar page's only way to the main process. It runs sandboxed, where `require` offers
// Electron's renderer modules and little else, so it is a CommonJS script that imports nothing of
// the app's own. Third-party pages never get this or any other preload.
import type { ToolbarBridge, ToolbarCommand, ToolbarState } from '../toolbar-state.ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const send = (command: ToolbarCommand, arg?: string) => ipcRenderer.send('toolbar', command, arg);

const bridge: ToolbarBridge = {
  navigate: (address) => send('navigate', String(address)),
  back: () => send('back'),
  forward: () => send('forward'),
  reload: () => send('reload'),
  stop: () => send('stop'),
  saveJob: () => send('save-job'),
  saveResults: () => send('save-results'),
  runAction: () => send('action'),
  onState: (listener) => {
    ipcRenderer.on('toolbar-state', (_event, state: ToolbarState) => listener(state));
  },
};

contextBridge.exposeInMainWorld('desktop', bridge);
