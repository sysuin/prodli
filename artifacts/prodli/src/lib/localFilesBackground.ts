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
const viewerUrl = (url: string) => chrome.runtime.getURL(`index.html?section=files&file=${encodeURIComponent(url)}`);
function maybeOpen(tabId: number, url: string): void {
  if (!ready || tabId < 0 || !isOpenableLocalFile(url)) return;
  const prev = recent.get(tabId);
  if (prev && prev.url === url && Date.now() - prev.at < 60_000) return;
  recent.set(tabId, { url, at: Date.now() });
  void chrome.tabs.update(tabId, { url: viewerUrl(url) }).catch(() => {});
}

/**
 * Chrome decided to download the file (it does for CSV) and closes the tab: cancel the
 * download and show the file in ProdLi instead, unless a tab already shows it.
 */
function onDownload(item: chrome.downloads.DownloadItem): void {
  const url = item.finalUrl || item.url;
  if (!ready || !isOpenableLocalFile(url)) return;
  void chrome.downloads.cancel(item.id).then(() => chrome.downloads.erase({ id: item.id })).catch(() => {});
  const viewer = viewerUrl(url);
  setTimeout(async () => {
    const tabs = await chrome.tabs.query({}).catch((): chrome.tabs.Tab[] => []);
    if (!tabs.some((t) => t.url === viewer || t.pendingUrl === viewer)) void chrome.tabs.create({ url: viewer });
  }, 600);
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
  // Only present once the user turned the feature on (optional permission).
  const watchDownloads = () => {
    if (chrome.downloads && !chrome.downloads.onCreated.hasListener(onDownload)) chrome.downloads.onCreated.addListener(onDownload);
  };
  watchDownloads();
  chrome.permissions.onAdded.addListener(watchDownloads);
}
