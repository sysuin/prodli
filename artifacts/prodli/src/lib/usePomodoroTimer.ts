import { onStorageChange } from "./storage";
import { useState, useEffect, useRef, useCallback } from "react";
import { storageSet } from "./storage";
import { formatTime } from "./utils";
import {
  completeIfDue,
  completionMessage,
  defaultTimer,
  DEFAULT_POMODORO_SETTINGS,
  getPomodoroTotal,
  loadPomodoro,
  nextPhaseAfter,
  pause,
  saveTimer,
  secondsLeftOf,
  start,
  TIMER_KEY,
  withPhase,
  type Phase,
  type PomodoroSession,
  type PomodoroSettings,
  type TimerState,
} from "./pomodoroCore";

export type { Phase, PomodoroSession, PomodoroSettings } from "./pomodoroCore";
export { DEFAULT_POMODORO_SETTINGS, getPomodoroTotal } from "./pomodoroCore";

function playChime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

function isExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage;
}

/**
 * Pomodoro timer for the UI. State lives in storage (see pomodoroCore), so
 * every open ProdLi tab shows the same timer and it keeps running when tabs
 * close. In the extension the background worker finishes phases; in the web
 * preview this hook does it.
 */
export function usePomodoroTimer() {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_POMODORO_SETTINGS);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [timer, setTimer] = useState<TimerState>(() => defaultTimer(DEFAULT_POMODORO_SETTINGS));
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  const timerRef = useRef(timer);
  const settingsRef = useRef(settings);
  const completedRef = useRef(completedPomodoros);
  const totalRef = useRef(getPomodoroTotal("work", DEFAULT_POMODORO_SETTINGS));
  const lastChimeRef = useRef<number | null>(null);
  const lastCheckRef = useRef(0);
  const completingRef = useRef(false);

  timerRef.current = timer;
  settingsRef.current = settings;
  completedRef.current = completedPomodoros;
  totalRef.current = getPomodoroTotal(timer.phase, settings);

  const applyTimer = useCallback((t: TimerState) => {
    // Chime once per finished phase, in the tab the user is looking at.
    if (t.lastCompletedAt && t.lastCompletedAt !== lastChimeRef.current) {
      const isNew = lastChimeRef.current !== null || Date.now() - t.lastCompletedAt < 5000;
      lastChimeRef.current = t.lastCompletedAt;
      if (isNew && document.visibilityState === "visible") playChime();
    }
    setTimer(t);
  }, []);

  const reloadAll = useCallback(async () => {
    const data = await loadPomodoro();
    setSettings(data.settings);
    setSessions(data.sessions);
    setCompletedPomodoros(data.completed);
    if (lastChimeRef.current === null) lastChimeRef.current = data.timer.lastCompletedAt ?? 0;
    applyTimer(data.timer);
  }, [applyTimer]);

  useEffect(() => {
    void reloadAll().then(() => setLoaded(true));
    if (!isExtension()) {
      // Web app: other tabs and ProdLi sync (history, completed count).
      const offs = [
        onStorageChange<TimerState>(TIMER_KEY, (v) => v && applyTimer(v)),
        onStorageChange<PomodoroSession[]>("pomodoroSessions", (v) => setSessions(v ?? [])),
        onStorageChange<number>("completedPomodoros", (v) => setCompletedPomodoros(v ?? 0)),
        onStorageChange<PomodoroSettings>("pomodoroSettings", (v) => v && setSettings(v)),
      ];
      return () => offs.forEach((off) => off());
    }
    // Keep in sync with other tabs and the background worker.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes[TIMER_KEY]?.newValue) applyTimer(changes[TIMER_KEY].newValue as TimerState);
      if (changes.pomodoroSessions) setSessions((changes.pomodoroSessions.newValue as PomodoroSession[] | undefined) ?? []);
      if (changes.completedPomodoros) setCompletedPomodoros((changes.completedPomodoros.newValue as number | undefined) ?? 0);
      if (changes.pomodoroSettings?.newValue) setSettings(changes.pomodoroSettings.newValue as PomodoroSettings);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [reloadAll, applyTimer]);

  // Tick while running.
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer.running]);

  const secondsLeft = secondsLeftOf(timer, now);

  // When the phase is over: the background normally handles it via an alarm.
  useEffect(() => {
    if (!timer.running || timer.endsAt === null || now < timer.endsAt) return;
    if (isExtension()) {
      // Nudge the background if its alarm is late.
      if (now - timer.endsAt > 1500 && now - lastCheckRef.current > 3000) {
        lastCheckRef.current = now;
        chrome.runtime.sendMessage({ target: "pomodoro", type: "check" }).catch(() => {});
      }
      return;
    }
    if (completingRef.current) return;
    completingRef.current = true;
    void completeIfDue(now).then(async (finished) => {
      if (finished && "Notification" in window && Notification.permission === "granted") {
        new Notification("ProdLi — Timer complete!", { body: completionMessage(finished) });
      }
      await reloadAll();
      completingRef.current = false;
    });
  }, [now, timer.running, timer.endsAt, reloadAll]);

  const update = useCallback((t: TimerState) => {
    setTimer(t);
    timerRef.current = t;
    void saveTimer(t);
  }, []);

  const setRunning = useCallback((r: boolean) => {
    const t = timerRef.current;
    const nowMs = Date.now();
    setNow(nowMs);
    update(r ? start(t, nowMs) : pause(t, nowMs));
  }, [update]);

  const setTaskLabel = useCallback((label: string) => update({ ...timerRef.current, label }), [update]);

  const reset = useCallback(() => {
    update(withPhase(timerRef.current, timerRef.current.phase, settingsRef.current));
  }, [update]);

  const skip = useCallback(() => {
    const { next } = nextPhaseAfter(timerRef.current.phase, completedRef.current, settingsRef.current);
    update(withPhase(timerRef.current, next, settingsRef.current));
  }, [update]);

  const changePhase = useCallback((p: Phase) => update(withPhase(timerRef.current, p, settingsRef.current)), [update]);

  const saveSettings = useCallback(async (newSettings: PomodoroSettings) => {
    const clamped: PomodoroSettings = {
      workDuration: Math.max(1, Math.min(120, newSettings.workDuration || 25)),
      shortBreak: Math.max(1, Math.min(60, newSettings.shortBreak || 5)),
      longBreak: Math.max(1, Math.min(60, newSettings.longBreak || 15)),
      longBreakAfter: Math.max(1, Math.min(10, newSettings.longBreakAfter || 4)),
    };
    setSettings(clamped);
    settingsRef.current = clamped;
    await storageSet("pomodoroSettings", clamped);
    update(withPhase(timerRef.current, timerRef.current.phase, clamped));
  }, [update]);

  useEffect(() => {
    if (timer.running) {
      const label = timer.phase === "work" ? "FOCUS" : "BREAK";
      document.title = `▶ ${formatTime(secondsLeft)} ${label} — ProdLi`;
    } else {
      document.title = "ProdLi";
    }
    return () => { document.title = "ProdLi"; };
  }, [timer.running, secondsLeft, timer.phase]);

  return {
    settings,
    sessions,
    setSessions,
    phase: timer.phase,
    completedPomodoros,
    running: timer.running,
    setRunning,
    taskLabel: timer.label,
    setTaskLabel,
    loaded,
    secondsLeft,
    totalRef,
    reset,
    skip,
    saveSettings,
    changePhase,
  };
}
