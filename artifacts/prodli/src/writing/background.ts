// Writing check, the background side.
//
// On demand (no permission): right-click in a text box → "Check writing with
// ProdLi", or the "check-writing" shortcut (no default key; Chrome's four
// suggested shortcuts are taken). Both grant activeTab, so the checker
// (writing-check.js) is injected into that tab and checks as you type there.
//
// Everywhere (optional): Settings → Writing check → "Check on every site" asks
// for the optional all-sites permission and registers the checker as a content
// script; turning it off (or removing the permission) unregisters it.
//
// The checker uses Chrome's on-device model itself when it's there; otherwise
// it asks here, and this calls ProdLi's AI with the account (cached, so the
// same paragraph is never checked twice).

import { accountRequest, accountsEnabled, getProdliAccount } from "../lib/prodliAccount";
import { DEFAULT_WRITING_SETTINGS, MAX_DICTIONARY, WRITING_SETTINGS_KEY } from "./settings";
import type { CheckIssue, CheckReply, RewriteReply, ToWritingBackground, ToWritingPage, WritingSettings } from "./types";

export const MENU_WRITING = "prodli_check_writing";
export const WRITING_COMMAND = "check-writing";
const SCRIPT_ID = "prodli-writing-check";
const ALL_SITES = { origins: ["<all_urls>"] };
const CACHE_KEY = "writingCheckCache";
const CACHE_MAX = 400;

export async function writingSettings(): Promise<WritingSettings> {
  const r = await chrome.storage.local.get(WRITING_SETTINGS_KEY);
  return { ...DEFAULT_WRITING_SETTINGS, ...((r[WRITING_SETTINGS_KEY] as Partial<WritingSettings> | undefined) ?? {}) };
}
async function saveSettings(patch: Partial<WritingSettings>): Promise<WritingSettings> {
  const next = { ...(await writingSettings()), ...patch };
  await chrome.storage.local.set({ [WRITING_SETTINGS_KEY]: next });
  return next;
}

function notify(title: string, message: string): void {
  chrome.notifications.create(`writing_${Date.now()}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message });
}

const cannotRun = (url: string | undefined) => !url || !/^(https?|file):/.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);

/** Puts the checker in this tab (all frames) and starts it where the user is typing. */
export async function startInTab(tab: chrome.tabs.Tab | undefined, frameId?: number): Promise<boolean> {
  if (!tab?.id) return false;
  if (cannotRun(tab.url)) {
    notify("Writing can't be checked here", "Chrome doesn't let extensions read text boxes on this page.");
    return false;
  }
  if (/^https:\/\/docs\.google\.com\/document\//.test(tab.url ?? "")) {
    notify("Google Docs isn't supported yet", "Docs draws its text in a way extensions can't read. Copy the text into a ProdLi note to check it there.");
    return false;
  }
  const host = new URL(tab.url!).hostname;
  const settings = await writingSettings();
  if (settings.offSites.includes(host)) await saveSettings({ offSites: settings.offSites.filter((h) => h !== host) });
  try {
    await chrome.scripting.executeScript({ target: frameId !== undefined ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id, allFrames: true }, files: ["writing-check.js"] });
  } catch {
    notify("Writing can't be checked here", "ProdLi couldn't reach this page. Reload it and try again.");
    return false;
  }
  await chrome.tabs.sendMessage(tab.id, { target: "writing-page", type: "start" } satisfies ToWritingPage, frameId !== undefined ? { frameId } : {}).catch(() => undefined);
  return true;
}

// ── ProdLi's AI, with a cache ─────────────────────────────────────────────────

type Cache = Record<string, { issues: CheckIssue[]; at: number }>;
async function readCache(): Promise<Cache> {
  const area = chrome.storage.session ?? chrome.storage.local;
  return ((await area.get(CACHE_KEY))[CACHE_KEY] as Cache | undefined) ?? {};
}
async function writeCache(cache: Cache): Promise<void> {
  const area = chrome.storage.session ?? chrome.storage.local;
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - CACHE_MAX)) delete cache[k];
  await area.set({ [CACHE_KEY]: cache });
}

const CHECK_MESSAGES = {
  check_quota_exceeded: "You've used this month's writing checks. They reset on the 1st, or get more with ProdLi Pro.",
  rate_limited: "Checking a lot at once. It will catch up in a moment.",
  ai_busy: "The writing check is busy. It will try again shortly.",
};

async function check(msg: Extract<ToWritingBackground, { type: "check" }>): Promise<CheckReply> {
  // Test builds: a stand-in for ProdLi's AI (tests/e2e/writing.mjs).
  const stub = import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliProofreadStub?: (p: string[]) => CheckIssue[][] }).__prodliProofreadStub : undefined;
  if (stub) return { ok: true, issues: stub(msg.paragraphs), used: 1, limit: 300 };
  if (!accountsEnabled()) return { ok: false, error: "unavailable", message: "The writing check isn't available in this copy of ProdLi." };
  if (!(await getProdliAccount())) return { ok: false, error: "signed_out", message: "Sign in to ProdLi (free) to check your writing." };
  const keyOf = (p: string) => `${msg.level}|${msg.variant ?? ""}|${p}`;
  const cache = await readCache();
  const results: (CheckIssue[] | null)[] = msg.paragraphs.map((p) => cache[keyOf(p)]?.issues ?? null);
  const todo = msg.paragraphs.map((p, i) => ({ p, i })).filter((x) => results[x.i] === null);
  let used: number | undefined;
  let limit: number | undefined;
  for (let k = 0; k < todo.length; k += 8) {
    const batch = todo.slice(k, k + 8);
    try {
      const r = await accountRequest<{ issues: (CheckIssue & { paragraph: number })[]; usage: { used: number; limit: number } }>(
        "/api/ai/proofread",
        { method: "POST", body: JSON.stringify({ paragraphs: batch.map((b) => b.p), level: msg.level, ...(msg.variant ? { variant: msg.variant } : {}) }) },
        CHECK_MESSAGES,
      );
      ({ used, limit } = r.usage);
      batch.forEach((b, j) => {
        const issues = r.issues.filter((x) => x.paragraph === j).map(({ paragraph: _p, ...rest }) => rest);
        results[b.i] = issues;
        cache[keyOf(b.p)] = { issues, at: Date.now() };
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = err instanceof Error ? err.message : "The writing check didn't work this time.";
      if (status === 401) return { ok: false, error: "signed_out", message: "Sign in to ProdLi (free) to check your writing." };
      if (status === 429 && /month/.test(message)) return { ok: false, error: "quota", message };
      return { ok: false, error: status === undefined ? "offline" : "busy", message };
    }
  }
  if (todo.length) await writeCache(cache);
  return { ok: true, issues: results.map((r) => r ?? []), used, limit };
}

async function rewrite(msg: Extract<ToWritingBackground, { type: "rewrite" }>): Promise<RewriteReply> {
  const stub = import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliRewriteStub?: (t: string, a: string) => string }).__prodliRewriteStub : undefined;
  if (stub) return { ok: true, text: stub(msg.text, msg.action), changed: true };
  if (!accountsEnabled() || !(await getProdliAccount())) return { ok: false, error: "signed_out", message: "Sign in to ProdLi (free) to rewrite text." };
  try {
    const r = await accountRequest<{ text: string; changed: boolean }>("/api/ai/rewrite", { method: "POST", body: JSON.stringify({ action: msg.action, text: msg.text.slice(0, 6000) }) });
    return { ok: true, text: r.text, changed: r.changed };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { ok: false, error: status === 429 ? "quota" : status === undefined ? "offline" : "busy", message: err instanceof Error ? err.message : "Couldn't rewrite it this time." };
  }
}

// ── Everywhere: the optional content script ───────────────────────────────────

/** Registers or unregisters the checker on every site, to match the setting and the permission. */
export async function syncEverywhere(): Promise<boolean> {
  const settings = await writingSettings();
  const granted = await chrome.permissions.contains(ALL_SITES).catch(() => false);
  const want = settings.everywhere && granted;
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => [])).length > 0;
  if (want && !registered) {
    await chrome.scripting
      .registerContentScripts([{ id: SCRIPT_ID, js: ["writing-check.js"], matches: ["<all_urls>"], excludeMatches: ["https://docs.google.com/document/*"], allFrames: true, runAt: "document_idle", persistAcrossSessions: true }])
      .catch(() => undefined);
  } else if (!want && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => undefined);
  }
  if (settings.everywhere && !granted) await saveSettings({ everywhere: false });
  return want;
}

export function registerWriting(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_WRITING) void startInTab(tab, info.frameId ?? 0);
  });
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === WRITING_COMMAND) void startInTab(tab);
  });
  chrome.runtime.onMessage.addListener((msg: ToWritingBackground, sender, reply) => {
    if (msg?.target !== "writing-bg") return false;
    void (async () => {
      switch (msg.type) {
        case "check":
          return reply(await check(msg));
        case "rewrite":
          return reply(await rewrite(msg));
        case "settings":
          return reply(await writingSettings());
        case "add-word": {
          const s = await writingSettings();
          const word = msg.word.trim().slice(0, 60);
          if (word && !s.dictionary.some((w) => w.toLowerCase() === word.toLowerCase())) await saveSettings({ dictionary: [...s.dictionary, word].slice(-MAX_DICTIONARY) });
          return reply(true);
        }
        case "site-off": {
          const s = await writingSettings();
          if (!s.offSites.includes(msg.host)) await saveSettings({ offSites: [...s.offSites, msg.host] });
          return reply(true);
        }
        case "open-settings":
          await chrome.tabs.create({ url: chrome.runtime.getURL("index.html#settings=writingcheck"), index: sender.tab ? sender.tab.index + 1 : undefined });
          return reply(true);
      }
    })();
    return true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[WRITING_SETTINGS_KEY]) void syncEverywhere();
  });
  chrome.permissions.onAdded.addListener(() => void syncEverywhere());
  chrome.permissions.onRemoved.addListener(() => void syncEverywhere());
  chrome.runtime.onStartup?.addListener(() => void syncEverywhere());
  chrome.runtime.onInstalled.addListener(() => void syncEverywhere());
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliStartWriting: startInTab, __prodliWritingCheck: check });
}
