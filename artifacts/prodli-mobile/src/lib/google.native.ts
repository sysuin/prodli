// Native Google sign-in (iOS and Android) → a Google ID token for ProdLi's web
// client audience, which the server verifies like the web app's (kind "mobile").
// Needs a development or store build (it isn't part of Expo Go).
import Constants from "expo-constants";
import { Platform } from "react-native";

type GoogleModule = typeof import("@react-native-google-signin/google-signin");

let mod: GoogleModule | null | undefined;
function load(): GoogleModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    mod = null;
  }
  return mod;
}

const extra = (Constants.expoConfig?.extra ?? {}) as { googleWebClientId?: string; googleIosClientId?: string };

let configured = false;
function configure(m: GoogleModule) {
  if (configured) return;
  m.GoogleSignin.configure({
    webClientId: extra.googleWebClientId,
    iosClientId: extra.googleIosClientId || undefined,
    scopes: ["openid", "email", "profile"],
    offlineAccess: false,
  });
  configured = true;
}

/** True when this build can show Google's sign-in. */
export function googleAvailable(): boolean {
  if (!load() || !extra.googleWebClientId) return false;
  return Platform.OS !== "ios" || !!extra.googleIosClientId;
}

export async function googleIdToken(): Promise<string> {
  const m = load();
  if (!m || !googleAvailable()) throw new Error("Google sign-in isn't set up in this build.");
  configure(m);
  if (Platform.OS === "android") await m.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await m.GoogleSignin.signIn();
  if (res.type !== "success") throw Object.assign(new Error("Sign-in cancelled."), { cancelled: true });
  const idToken = res.data.idToken ?? (await m.GoogleSignin.getTokens()).idToken;
  if (!idToken) throw new Error("Google didn't return a sign-in token. Try again.");
  return idToken;
}

export async function googleSignOut(): Promise<void> {
  const m = load();
  if (!m) return;
  try {
    configure(m);
    await m.GoogleSignin.signOut();
  } catch {
    // Not signed in with Google on this phone: nothing to do.
  }
}
