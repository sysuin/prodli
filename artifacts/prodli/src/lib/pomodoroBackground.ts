// Background half of the Pomodoro timer: schedules an alarm for the end of the
// running phase, finishes the phase when it fires, and shows the notification —
// even if no ProdLi tab is open.

import { completeIfDue, completionMessage, loadPomodoro, POMODORO_ALARM, TIMER_KEY, type TimerState } from "./pomodoroCore";

async function schedule(t: TimerState | undefined): Promise<void> {
  await chrome.alarms.clear(POMODORO_ALARM);
  if (t?.running && t.endsAt !== null) {
    if (t.endsAt <= Date.now()) await finish();
    else await chrome.alarms.create(POMODORO_ALARM, { when: t.endsAt });
  }
}

async function finish(): Promise<void> {
  const finished = await completeIfDue();
  if (!finished) return;
  chrome.notifications.create(`pomodoro_${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "ProdLi — Timer complete!",
    message: completionMessage(finished),
  });
}

export function registerPomodoro(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && TIMER_KEY in changes) void schedule(changes[TIMER_KEY].newValue as TimerState | undefined);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POMODORO_ALARM) void finish();
  });

  chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string }, _sender, sendResponse) => {
    if (msg?.target !== "pomodoro" || msg.type !== "check") return undefined;
    finish().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  });

  // After a browser restart or worker update, re-arm (or finish) the timer.
  void loadPomodoro().then(({ timer }) => schedule(timer));
}
