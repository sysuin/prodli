// Google sign-in. This default is used by the web preview and tests, where
// native Google sign-in doesn't exist; the phone apps use google.native.ts.
export const googleAvailable = (): boolean => false;

export async function googleIdToken(): Promise<string> {
  throw new Error("Google sign-in works in the iOS and Android apps.");
}

export async function googleSignOut(): Promise<void> {}
