// Build settings from app.config.ts (extra), applied once at start-up.
import Constants from "expo-constants";
import { configureApi } from "./api";

export const extra = (Constants.expoConfig?.extra ?? {}) as { api?: string; googleWebClientId?: string; googleIosClientId?: string };

export function applyConfig(): void {
  configureApi({ base: extra.api || "https://app.prodli.com" });
}

/** True when the app talks to a local development server (developer sign-in is offered). */
export const isLocalServer = (): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.)/.test(extra.api ?? "");
