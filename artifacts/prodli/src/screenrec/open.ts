// Opens the screen recorder (index.html#record): its own tab in the extension
// and the web app, so it can keep recording while you work in other tabs. The
// desktop app opens it in the main window (it doesn't open new windows).

import { isDesktop } from "../lib/desktop";

export const RECORD_HASH = "#record";

export function openRecorder(): void {
  const ext = typeof chrome !== "undefined" && !!chrome.runtime?.id && location.protocol === "chrome-extension:";
  if (ext) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${RECORD_HASH}`) });
  } else if (isDesktop()) {
    location.hash = RECORD_HASH;
    location.reload();
  } else {
    window.open(`${location.pathname}${RECORD_HASH}`, "_blank", "noopener");
  }
}
