// Test builds only (VITE_E2E=1): notifications stay inside the test browser.
// Headless Chrome on macOS still hands chrome.notifications to the system, so
// running the end-to-end tests used to pop "Meeting saved" & co. on the
// developer's screen. Here they're kept in memory, and getAll/clear work on
// that, so tests can still check them.

type Opts = chrome.notifications.NotificationOptions;

export function keepNotificationsInside(): void {
  const shown = new Map<string, Opts>();
  let n = 0;
  const api = chrome.notifications as unknown as Record<string, unknown>;
  api.create = (idOrOpts: string | Opts, maybeOpts?: Opts | ((id: string) => void), cb?: (id: string) => void) => {
    const id = typeof idOrOpts === "string" ? idOrOpts || `n${++n}` : `n${++n}`;
    const opts = (typeof idOrOpts === "string" ? maybeOpts : idOrOpts) as Opts;
    const done = (typeof maybeOpts === "function" ? maybeOpts : cb) as ((id: string) => void) | undefined;
    shown.set(id, opts);
    done?.(id);
    return Promise.resolve(id);
  };
  api.getAll = (cb?: (all: Record<string, boolean>) => void) => {
    const all = Object.fromEntries([...shown.keys()].map((k) => [k, true]));
    cb?.(all);
    return Promise.resolve(all);
  };
  api.clear = (id: string, cb?: (cleared: boolean) => void) => {
    const had = shown.delete(id);
    cb?.(had);
    return Promise.resolve(had);
  };
}
