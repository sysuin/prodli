// "Insert a snippet", the background side: right-click in a text box →
// "Insert a ProdLi snippet", or the "insert-snippet" shortcut (no default key:
// Chrome allows four suggested shortcuts and ProdLi uses them; people set one
// in chrome://extensions/shortcuts). Both grant activeTab for that tab, so no
// host permission is needed. The picker (picker.ts) types the chosen snippet in.

import { SNIPPETS_KEY, type Snippet } from "../dictation/core";
import { fillSnippet, matchSnippets } from "../lib/snippets";
import type { PickerMode, PickerOpened, PickerSnippet, ToPicker } from "./messages";

export const MENU_SNIPPET = "prodli_insert_snippet";
export const SNIPPET_COMMAND = "insert-snippet";

function notify(title: string, message: string): void {
  chrome.notifications.create(`snippet_${Date.now()}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message });
}

async function pickerSnippets(): Promise<PickerSnippet[]> {
  const r = await chrome.storage.local.get(SNIPPETS_KEY);
  const now = new Date();
  return matchSnippets((r[SNIPPETS_KEY] as Snippet[] | undefined) ?? [], "").map((s) => ({ id: s.id, cue: s.cue, text: fillSnippet(s.text, now) }));
}

const cannotRun = (url: string | undefined) => !url || !/^(https?|file):/.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);

/** Opens the picker in the tab: in one frame (right-click), or wherever the user is typing (shortcut). */
export async function openSnippetPicker(tab: chrome.tabs.Tab | undefined, frameId?: number): Promise<boolean> {
  if (!tab?.id) return false;
  if (cannotRun(tab.url)) {
    notify("Snippets can't be inserted here", "Chrome doesn't let extensions type on this page. In ProdLi itself, press Ctrl/⌘+K and type “s ” to copy a snippet.");
    return false;
  }
  const snippets = await pickerSnippets();
  const target = frameId !== undefined ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ["snippet-picker.js"] });
  } catch {
    notify("Snippets can't be inserted here", "ProdLi couldn't reach this page. Reload it and try again.");
    return false;
  }
  const send = (mode: PickerMode, options?: chrome.tabs.MessageSendOptions) =>
    chrome.tabs.sendMessage(tab.id!, { target: "snippet-picker", type: "open", snippets, mode } satisfies ToPicker, options ?? {}).catch(() => undefined) as Promise<PickerOpened | undefined>;
  if (frameId !== undefined) return !!(await send("frame", { frameId }));
  if (await send("focused")) return true;
  // No text box focused (e.g. the address bar): show it anyway; the snippet is copied.
  return !!(await send("top", { frameId: 0 }));
}

export function registerSnippets(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SNIPPET) void openSnippetPicker(tab, info.frameId ?? 0);
  });
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === SNIPPET_COMMAND) void openSnippetPicker(tab);
  });
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliOpenSnippetPicker: openSnippetPicker });
}
