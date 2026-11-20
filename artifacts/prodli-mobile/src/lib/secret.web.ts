// Web preview only (a developer tool, not a shipped product): sessionStorage,
// so the token is gone when the tab closes.
const ss = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
export const secret = {
  get: (k: string): string | null => ss()?.getItem(k) ?? null,
  set: (k: string, v: string): void => ss()?.setItem(k, v),
  remove: (k: string): void => ss()?.removeItem(k),
};
