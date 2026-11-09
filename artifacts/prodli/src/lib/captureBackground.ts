// Background (extension): right-click "Add to ProdLi" menus and the Quick add shortcut.
import { addNote, addTask } from "./capture";
import { accountsEnabled } from "./prodliAccount";
import { syncOnce } from "./prodliSync";

const MENU_TODO = "prodli-add-todo";
const MENU_NOTE = "prodli-add-note";

function notify(title: string, message: string): void {
  chrome.notifications.create(`prodli-capture-${Date.now()}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message: message.slice(0, 180), priority: 0 });
}

/** Opens the small Quick add window for the current tab. */
async function openQuickAdd(tab?: chrome.tabs.Tab, text?: string): Promise<void> {
  const t = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const params = new URLSearchParams();
  const isWeb = t?.url && /^https?:/.test(t.url);
  if (isWeb && t?.title) params.set("title", t.title);
  if (isWeb && t?.url) params.set("url", t.url);
  if (text) params.set("text", text);
  await chrome.windows.create({ url: chrome.runtime.getURL(`index.html#quick-add?${params}`), type: "popup", width: 460, height: 420, focused: true });
}

export function registerCapture(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_TODO, title: "Add to ProdLi to-dos", contexts: ["page", "selection", "link"] });
      chrome.contextMenus.create({ id: MENU_NOTE, title: "Save to ProdLi notes", contexts: ["page", "selection", "link"] });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void (async () => {
      const selection = info.selectionText?.trim();
      const url = info.linkUrl ?? info.pageUrl ?? tab?.url;
      const pageTitle = info.linkUrl ? info.linkUrl : (tab?.title ?? "");
      if (info.menuItemId === MENU_TODO) {
        const t = await addTask({ title: selection || pageTitle, text: selection ? "" : undefined, url });
        notify("Added to ProdLi to-dos", t.title);
      } else if (info.menuItemId === MENU_NOTE) {
        const n = await addNote({ title: selection ? (tab?.title ?? "Saved from the web") : pageTitle, text: selection, url });
        notify("Saved to ProdLi notes", n.title);
      } else return;
      if (accountsEnabled()) void syncOnce({ onlyIfLocalChanges: true }).catch(() => {});
    })();
  });

  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === "quick-add") void openQuickAdd(tab);
  });
}
