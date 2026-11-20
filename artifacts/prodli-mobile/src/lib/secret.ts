// Where the session token lives. This default (memory) is for unit tests; the
// app uses secret.native.ts (iOS Keychain / Android Keystore via
// expo-secure-store) or secret.web.ts (the web preview).
const m = new Map<string, string>();
export const secret = {
  get: (k: string): string | null => m.get(k) ?? null,
  set: (k: string, v: string): void => void m.set(k, v),
  remove: (k: string): void => void m.delete(k),
};
