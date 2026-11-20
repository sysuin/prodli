// The ProdLi account on this phone: sign in, sign out, profile.
import { Platform } from "react-native";
import { forgetSession, getAccount, request, saveSession, type ProdliUser, ACCOUNT_KEY } from "./api";
import { googleIdToken, googleSignOut } from "./google";
import { write } from "./store";
import { resetSyncState } from "./sync";

interface SignInResponse {
  user: ProdliUser;
  token: string;
  session: { id: string; expiresAt: number };
}

async function signInWithIdToken(idToken: string): Promise<ProdliUser> {
  const r = await request<SignInResponse>("/api/auth/google", { method: "POST", body: JSON.stringify({ kind: "mobile", idToken, platform: Platform.OS }) });
  resetSyncState(); // a fresh start with this account; what's on the phone is added to it
  saveSession(r.user, r.token);
  return r.user;
}

export async function signInWithGoogle(): Promise<ProdliUser> {
  return signInWithIdToken(await googleIdToken());
}

/**
 * Developers only: a local server started with DEV_FAKE_GOOGLE=true accepts
 * "good:<id>:<email>" instead of a Google token (see docs/MOBILE.md).
 */
export async function signInForDevelopment(email: string): Promise<ProdliUser> {
  const id = email.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return signInWithIdToken(`good:${id}:${email.trim()}`);
}

export async function refreshAccount(): Promise<ProdliUser | null> {
  try {
    const { user } = await request<{ user: ProdliUser }>("/api/me");
    write(ACCOUNT_KEY, user);
    return user;
  } catch {
    return getAccount();
  }
}

export async function signOut(): Promise<void> {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch {
    // Already signed out on the server, or offline: forget it here anyway.
  }
  forgetSession();
  resetSyncState();
  await googleSignOut();
}

export async function signOutEverywhere(): Promise<void> {
  await request("/api/auth/logout-all", { method: "POST" });
  forgetSession();
  resetSyncState();
  await googleSignOut();
}

export interface Device {
  id: string;
  client: "extension" | "web" | "mobile";
  device: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export async function listDevices(): Promise<Device[]> {
  return (await request<{ sessions: Device[] }>("/api/sessions")).sessions;
}

export async function signOutDevice(id: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteAccount(confirmEmail: string): Promise<void> {
  await request("/api/account", { method: "DELETE", body: JSON.stringify({ confirmEmail }) });
  forgetSession();
  resetSyncState();
  await googleSignOut();
}

export interface AiUsage {
  used: number;
  limit: number;
  available: boolean;
  briefs?: { used: number; limit: number };
  asks?: { used: number; limit: number };
  writes?: { used: number; limit: number };
}

export const getAiUsage = () => request<AiUsage>("/api/ai/usage");

export interface BillingInfo {
  plan: "free" | "pro";
  subscription: { status: string; interval: string | null; renewsAt: number | null; endsAt: number | null } | null;
  limits: Record<"free" | "pro", { storageBytes: number; summaries: number; briefs: number; asks: number; writes: number; transcribeMinutes: number }>;
}

export const getBilling = () => request<BillingInfo>("/api/billing");
