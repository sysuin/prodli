// Background (extension): local Markdown/CSV/JSON/text files opened in Chrome
// are shown in ProdLi's Files viewer instead (see localFiles.ts).
//
// It must act before Chrome loads the file: for some types (CSV) Chrome starts
// a download and closes the tab. So the "may we?" answer is kept in memory and
// refreshed when permissions or the setting change.
import { isOpenableLocalFile, localFileAccess, OPEN_LOCAL_FILES_KEY } from "./localFiles";

let ready = false;
async function refresh(): Promise<void> {
  const [access, stored] = await Promise.all([localFileAccess(), chrome.storage.local.get(OPEN_LOCAL_FILES_KEY)]);
  ready = access.permission && access.fileUrls && ((stored[OPEN_LOCAL_FILES_KEY] as boolean | undefined) ?? true);
}

// Pressing Back from ProdLi returns to the file: don't bounce straight back.
const recent = new Map<number, { url: string; at: number }>();

function maybeOpen(tabId: number, url: string): void {
  if (!ready || tabId < 0 || !isOpenableLocalFile(url)) return;
  const prev = recent.get(tabId);
  if (prev && prev.url === url && Date.now() - prev.at < 60_000) return;
  recent.set(tabId, { url, at: Date.now() });
  void chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`index.html?section=files&file=${encodeURIComponent(url)}`) }).catch(() => {});
}

export function registerLocalFiles(): void {
  void refresh();
  chrome.permissions.onAdded.addListener(() => void refresh());
  chrome.permissions.onRemoved.addListener(() => void refresh());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && OPEN_LOCAL_FILES_KEY in changes) void refresh();
  });
  // "Allow access to file URLs" has no change event; Chrome restarts the extension when it's toggled,
  // and this re-checks every few minutes as a safety net.
  setInterval(() => void refresh(), 5 * 60_000);

  // Before the page loads (beats Chrome's download of CSV and similar files).
  chrome.webNavigation?.onBeforeNavigate.addListener((d) => {
    if (d.frameId === 0) maybeOpen(d.tabId, d.url);
  });
  // Fallback, e.g. when the navigation event isn't available.
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) maybeOpen(tabId, change.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => recent.delete(tabId));
}
