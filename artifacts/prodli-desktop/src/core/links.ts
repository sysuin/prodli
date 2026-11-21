// Which links leave the app for the default browser / mail app, and which
// navigations the app's windows may make. Everything else is refused.

import { APP_ORIGIN } from "./assets";

/** http(s) and mailto only: never file:, javascript:, custom app schemes, etc. */
export function isExternalLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "mailto:") return true;
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The app's windows only ever show the app's own pages. */
export function isAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.origin === APP_ORIGIN || `${u.protocol}//${u.host}` === APP_ORIGIN;
  } catch {
    return false;
  }
}
