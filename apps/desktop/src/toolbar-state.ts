/** What the toolbar shows. The main process sends it whenever something changes. */
export interface ToolbarState {
  /** The built-in browser's page; '' before the user opened one. */
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  /** Whether the page's site has a reader for results pages. */
  canSaveResults: boolean;
  /** A save is running. */
  busy: boolean;
  /** The last thing that happened, and the label of the one thing the user can do about it. */
  status: { text: string; tone: 'info' | 'success' | 'error'; action: string | null };
}

/** What the toolbar page may ask of the main process, exposed to it as `window.desktop`. */
export interface ToolbarBridge {
  navigate(address: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  saveJob(): void;
  saveResults(): void;
  /** Does what the status line's button says. */
  runAction(): void;
  onState(listener: (state: ToolbarState) => void): void;
}

/** The commands the toolbar sends on the `toolbar` channel. */
export type ToolbarCommand =
  'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'save-job' | 'save-results' | 'action';
