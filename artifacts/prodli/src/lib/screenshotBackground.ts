// Background (extension): "Screenshot to ProdLi". Takes a picture of the
// visible part of the tab and opens the annotator (screenshot.html) in a small
// window. No extra permission: activeTab is granted by the right-click on the
// page, and by the Quick add shortcut (Alt+Shift+A) for the tab it was pressed
// on, which is how the Quick add window's 📸 button can take one.

import { blockedPage, captureErrorMessage, PENDING_KEY, SCREENSHOT_MESSAGE, type PendingShot } from "./screenshotCore";

export const MENU_SCREENSHOT = "prodli-screenshot";

/** Added with the other right-click menus (captureBackground.ts, on install). */
export function createScreenshotMenu(): void {
  chrome.contextMenus.create({ id: MENU_SCREENSHOT, title: "Screenshot to ProdLi", contexts: ["page", "selection", "link", "image"] });
}

function notify(title: string, message: string): void {
  chrome.notifications.create(`prodli-shot-${Date.now()}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message: message.slice(0, 180), priority: 0 });
}

/** chrome.storage.session holds about 10 MB; very large PNGs go as high-quality JPEG instead. */
const MAX_PNG_CHARS = 7_000_000;

/** Takes the screenshot and opens the annotator. Returns an error message to show, or null. */
export async function takeScreenshot(tab: chrome.tabs.Tab | undefined): Promise<string | null> {
  if (!tab?.id || tab.windowId === undefined) return captureErrorMessage(undefined);
  if (blockedPage(tab.url)) return captureErrorMessage(tab.url);
  if (!tab.active) return "Go back to that page and try again.";
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    if (dataUrl.length > MAX_PNG_CHARS) dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 92 });
  } catch {
    return captureErrorMessage(tab.url);
  }
  const isWeb = !!tab.url && /^https?:/.test(tab.url);
  const shot: PendingShot = { id: crypto.randomUUID(), dataUrl, title: isWeb ? (tab.title ?? "") : "", url: isWeb ? tab.url! : "", at: Date.now() };
  try {
    await chrome.storage.session.set({ [PENDING_KEY]: shot });
  } catch {
    return "This screenshot is too big. Make the window smaller and try again.";
  }
  await chrome.windows.create({ url: chrome.runtime.getURL(`screenshot.html#${shot.id}`), type: "popup", width: 920, height: 720, focused: true });
  return null;
}

async function fromMenu(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const error = await takeScreenshot(tab);
  if (error) notify("Can't take a screenshot", error);
}

export function registerScreenshot(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SCREENSHOT) void fromMenu(tab);
  });
  // The Quick add window's 📸 button: { target, tabId } → { ok, error? }.
  chrome.runtime.onMessage.addListener((msg: { target?: string; tabId?: number }, _sender, sendResponse) => {
    if (msg?.target !== SCREENSHOT_MESSAGE || typeof msg.tabId !== "number") return undefined;
    chrome.tabs
      .get(msg.tabId)
      .then((tab) => takeScreenshot(tab))
      .catch(() => "That page was closed. Open it and try again.")
      .then((error) => sendResponse(error ? { ok: false, error } : { ok: true }));
    return true;
  });
  // Test builds: the end-to-end tests can't right-click, so they call this with a tab.
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliScreenshot: takeScreenshot });
}
