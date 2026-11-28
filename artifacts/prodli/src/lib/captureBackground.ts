// Background (extension): right-click "Add to ProdLi" menus and the Quick add shortcut.
import { addNote, addTask } from "./capture";
import { MENU_SNIPPET } from "../snippets/background";
import { MENU_WRITING } from "../writing/background";
import { accountsEnabled } from "./prodliAccount";
import { syncOnce } from "./prodliSync";
import { addReadLater, extractPageText, MAX_PAGE_CHARS, saveHighlight, savePageNote } from "./readLater";
import { createScreenshotMenu } from "./screenshotBackground";

const MENU_TODO = "prodli-add-todo";
const MENU_NOTE = "prodli-add-note";
const MENU_READ_LATER = "prodli-read-later";
const MENU_SUMMARIZE = "prodli-summarize-page";
const MENU_HIGHLIGHT = "prodli-save-highlight";

/** Each confirmation gets its own id: two saved in the same millisecond used to replace each other. */
let notified = 0;
function notify(title: string, message: string): void {
  chrome.notifications.create(`prodli-capture-${Date.now()}-${++notified}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message: message.slice(0, 180), priority: 0 });
}

/**
 * "Save highlight to ProdLi": the selected text (from the menu click itself,
 * no page access) goes to that page's note. Returns whether it was saved.
 */
async function onSaveHighlight(selection: string | undefined, url: string | undefined, title: string | undefined): Promise<boolean> {
  const r = await saveHighlight({ quote: selection, url, title });
  if (!r) {
    notify("Can't save this highlight", "Select text on a web page, then right-click → Save highlight to ProdLi.");
    return false;
  }
  notify(r.created ? "Highlight saved to a new note" : "Highlight added to your note", r.note.title);
  return true;
}

/** Opens the small Quick add window for the current tab. */
async function openQuickAdd(tab?: chrome.tabs.Tab, text?: string): Promise<void> {
  const t = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const params = new URLSearchParams();
  const isWeb = t?.url && /^https?:/.test(t.url);
  if (isWeb && t?.title) params.set("title", t.title);
  if (isWeb && t?.url) params.set("url", t.url);
  if (text) params.set("text", text);
  // For the window's 📸 button: the shortcut gave ProdLi this tab (activeTab) for a screenshot.
  if (isWeb && t?.id) params.set("tab", String(t.id));
  await chrome.windows.create({ url: chrome.runtime.getURL(`index.html#quick-add?${params}`), type: "popup", width: 460, height: 420, focused: true });
}

export function registerCapture(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_TODO, title: "Add to ProdLi to-dos", contexts: ["page", "selection", "link"] });
      chrome.contextMenus.create({ id: MENU_NOTE, title: "Save to ProdLi notes", contexts: ["page", "selection", "link"] });
      chrome.contextMenus.create({ id: MENU_READ_LATER, title: "Read later in ProdLi", contexts: ["page", "link"] });
      chrome.contextMenus.create({ id: MENU_SUMMARIZE, title: "Summarize page to ProdLi notes", contexts: ["page"] });
      chrome.contextMenus.create({ id: MENU_HIGHLIGHT, title: "Save highlight to ProdLi", contexts: ["selection"] });
      chrome.contextMenus.create({ id: MENU_SNIPPET, title: "Insert a ProdLi snippet", contexts: ["editable"] });
      chrome.contextMenus.create({ id: MENU_WRITING, title: "Check writing with ProdLi", contexts: ["editable"] });
      createScreenshotMenu();
    });
  });
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliSaveHighlight: onSaveHighlight, __prodliOpenQuickAdd: openQuickAdd });

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
      } else if (info.menuItemId === MENU_READ_LATER) {
        const item = await addReadLater(info.linkUrl ?? info.pageUrl ?? tab?.url, info.linkUrl ? info.linkUrl : tab?.title);
        if (!item) return notify("Can't save this page", "Only web pages can be saved to Read later.");
        notify("Saved to Read later", item.title);
      } else if (info.menuItemId === MENU_HIGHLIGHT) {
        if (!(await onSaveHighlight(info.selectionText, info.pageUrl ?? tab?.url, tab?.title))) return;
      } else if (info.menuItemId === MENU_SUMMARIZE) {
        if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return notify("Can't summarize this page", "Only web pages can be summarized.");
        notify("Summarizing…", tab.title ?? tab.url);
        let page = { title: tab.title ?? "", url: tab.url, text: "" };
        try {
          // activeTab: this click allows reading just this tab, just now.
          const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageText, args: [MAX_PAGE_CHARS] });
          const got = res?.result as { title: string; text: string } | undefined;
          if (got) page = { ...page, title: got.title || page.title, text: got.text };
        } catch {
          // Some pages (the Web Store, PDFs, browser pages) can't be read; save the link anyway.
        }
        const { note, summarized } = await savePageNote(page);
        notify(summarized ? "Summary saved to ProdLi notes" : "Saved to ProdLi notes", note.title);
      } else return;
      if (accountsEnabled()) void syncOnce({ onlyIfLocalChanges: true }).catch(() => {});
    })();
  });

  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === "quick-add") void openQuickAdd(tab);
  });
}
