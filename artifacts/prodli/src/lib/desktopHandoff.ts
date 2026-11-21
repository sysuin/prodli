// The web app's half of the desktop sign-in (artifacts/prodli-api/src/desktopAuth.ts):
// the desktop app opens app.prodli.com/?desktop=signin&port=…&state=…&challenge=…
// in the system browser; once the user is signed in and clicks "Open ProdLi",
// the page fetches a one-time code and sends the browser to the app's loopback
// listener at http://127.0.0.1:<port>/callback.
//
// Pure (no DOM, no network) so it can be tested; the page is DesktopHandoff.tsx.

export interface DesktopHandoff {
  port: number;
  state: string;
  challenge: string;
}

const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Reads the hand-off request from a URL query string; null if it isn't one (or is malformed). */
export function parseDesktopHandoff(search: string): DesktopHandoff | null {
  const q = new URLSearchParams(search);
  if (q.get("desktop") !== "signin") return null;
  const portText = q.get("port") ?? "";
  const port = /^\d{4,5}$/.test(portText) ? Number(portText) : NaN;
  const state = q.get("state") ?? "";
  const challenge = q.get("challenge") ?? "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !STATE.test(state) || !CHALLENGE.test(challenge)) return null;
  return { port, state, challenge };
}

/** Where the browser goes with the code. Always the loopback address, never a host from the URL. */
export function loopbackCallback(h: DesktopHandoff, code: string): string {
  return `http://127.0.0.1:${h.port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(h.state)}`;
}

/** The URL the desktop app opens (it builds the same thing; kept here so the two stay in step in tests). */
export function handoffUrl(appOrigin: string, h: DesktopHandoff): string {
  const q = new URLSearchParams({ desktop: "signin", port: String(h.port), state: h.state, challenge: h.challenge });
  return `${appOrigin.replace(/\/+$/, "")}/?${q.toString()}`;
}
