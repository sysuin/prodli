// Background (extension): runs scheduled Ask ProdLi prompts. One alarm per
// scheduled prompt at its next time; when it fires, ProdLi asks the question
// (one Ask use), keeps the answer in the inbox and shows a notification.

import { askProdli, canAsk } from "./ask";
import { addToInbox, getPrompts, nextRun, OPEN_INBOX_KEY, PROMPTS_KEY } from "./askPrompts";
import { storageSet } from "./storage";

const ALARM = "askprompt:";
const NOTIFICATION = "askanswer:";

export async function scheduleAskPrompts(now = new Date()): Promise<void> {
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter((a) => a.name.startsWith(ALARM)).map((a) => chrome.alarms.clear(a.name)));
  for (const p of await getPrompts()) {
    const when = p.schedule ? nextRun(p.schedule, now) : null;
    if (when) await chrome.alarms.create(`${ALARM}${p.id}`, { when });
  }
}

async function run(promptId: string): Promise<void> {
  const p = (await getPrompts()).find((x) => x.id === promptId);
  if (!p?.schedule) return;
  try {
    if (!(await canAsk())) return;
    const r = await askProdli(p.text, []);
    const item = await addToInbox({ promptId: p.id, question: p.text, answer: r.answer, sources: r.sources, at: new Date().toISOString() });
    chrome.notifications.create(`${NOTIFICATION}${item.id}`, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: `✨ ${p.text}`.slice(0, 120),
      message: r.answer.replace(/\s+/g, " ").slice(0, 200),
      priority: 1,
    });
  } catch {
    // Offline, out of questions or signed out: try again next time.
  } finally {
    await scheduleAskPrompts();
  }
}

export function registerAskPrompts(): void {
  void scheduleAskPrompts();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PROMPTS_KEY]) void scheduleAskPrompts();
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name.startsWith(ALARM)) void run(a.name.slice(ALARM.length));
  });
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFICATION)) return;
    chrome.notifications.clear(id);
    void storageSet(OPEN_INBOX_KEY, id.slice(NOTIFICATION.length)).then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
  });
}
