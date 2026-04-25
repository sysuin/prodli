import { useState, useEffect, useRef, useCallback } from "react";
import { storageGet, storageSet } from "./storage";
import { formatTime } from "./utils";

export type Phase = "work" | "short-break" | "long-break";

export interface PomodoroSettings {
  workDuration: number;
  shortBreak: number;
  longBreak: number;
  longBreakAfter: number;
}

export interface PomodoroSession {
  id: string;
  label: string;
  completedAt: string;
  duration: number;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workDuration: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakAfter: 4,
};

export function getPomodoroTotal(phase: Phase, s: PomodoroSettings) {
  if (phase === "work") return s.workDuration * 60;
  if (phase === "short-break") return s.shortBreak * 60;
  return s.longBreak * 60;
}

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

export function usePomodoroTimer() {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_POMODORO_SETTINGS);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [phase, setPhase] = useState<Phase>("work");
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [running, setRunning] = useState(false);
  const [taskLabel, setTaskLabel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => getPomodoroTotal("work", DEFAULT_POMODORO_SETTINGS));

  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const totalRef = useRef(getPomodoroTotal("work", DEFAULT_POMODORO_SETTINGS));

  // Refs to avoid stale closures in the persistent interval
  const phaseRef = useRef<Phase>("work");
  const taskLabelRef = useRef("");
  const settingsRef = useRef<PomodoroSettings>(DEFAULT_POMODORO_SETTINGS);
  const completedPomodorosRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { taskLabelRef.current = taskLabel; }, [taskLabel]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { completedPomodorosRef.current = completedPomodoros; }, [completedPomodoros]);

  useEffect(() => {
    Promise.all([
      storageGet<PomodoroSettings>("pomodoroSettings", DEFAULT_POMODORO_SETTINGS),
      storageGet<PomodoroSession[]>("pomodoroSessions", []),
      storageGet<number>("completedPomodoros", 0),
    ]).then(([s, sess, cp]) => {
      setSettings(s);
      settingsRef.current = s;
      setSessions(sess);
      setCompletedPomodoros(cp);
      completedPomodorosRef.current = cp;
      const total = getPomodoroTotal("work", s);
      setSecondsLeft(total);
      totalRef.current = total;
      setLoaded(true);
    });
  }, []);

  const transitionPhase = useCallback((current: Phase, currentCompleted: number, s: PomodoroSettings) => {
    let nextPhase: Phase;
    let nextCompleted = currentCompleted;
    if (current === "work") {
      nextCompleted = currentCompleted + 1;
      nextPhase = nextCompleted % s.longBreakAfter === 0 ? "long-break" : "short-break";
    } else {
      nextPhase = "work";
    }
    const total = getPomodoroTotal(nextPhase, s);
    setPhase(nextPhase);
    phaseRef.current = nextPhase;
    setSecondsLeft(total);
    totalRef.current = total;
    setRunning(false);
    return { nextPhase, nextCompleted };
  }, []);

  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          playChime();
          const currentPhase = phaseRef.current;
          const currentTaskLabel = taskLabelRef.current;
          const currentSettings = settingsRef.current;
          if (Notification.permission === "granted") {
            new Notification("ProdLi — Timer complete!", {
              body: currentPhase === "work" ? "Time for a break!" : "Back to work!",
            });
          }
          if (currentPhase === "work") {
            const newSession: PomodoroSession = {
              id: Date.now().toString(),
              label: currentTaskLabel || "Focus session",
              completedAt: new Date().toISOString(),
              duration: currentSettings.workDuration,
            };
            setSessions(prev => {
              const updated = [newSession, ...prev].slice(0, 20);
              storageSet("pomodoroSessions", updated);
              return updated;
            });
          }
          setCompletedPomodoros(prev => {
            const nc = currentPhase === "work" ? prev + 1 : prev;
            completedPomodorosRef.current = nc;
            storageSet("completedPomodoros", nc);
            transitionPhase(currentPhase, nc, currentSettings);
            return nc;
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, transitionPhase]);

  const reset = useCallback(() => {
    setRunning(false);
    const total = getPomodoroTotal(phaseRef.current, settingsRef.current);
    setSecondsLeft(total);
    totalRef.current = total;
  }, []);

  const skip = useCallback(() => {
    setRunning(false);
    transitionPhase(phaseRef.current, completedPomodorosRef.current, settingsRef.current);
  }, [transitionPhase]);

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
    const total = getPomodoroTotal(phaseRef.current, clamped);
    setSecondsLeft(total);
    totalRef.current = total;
    setRunning(false);
  }, []);

  const changePhase = useCallback((p: Phase) => {
    setRunning(false);
    setPhase(p);
    phaseRef.current = p;
    const t = getPomodoroTotal(p, settingsRef.current);
    setSecondsLeft(t);
    totalRef.current = t;
  }, []);

  useEffect(() => {
    if (running) {
      const label = phase === "work" ? "FOCUS" : "BREAK";
      document.title = `▶ ${formatTime(secondsLeft)} ${label} — ProdLi`;
    } else {
      document.title = "ProdLi";
    }
    return () => { document.title = "ProdLi"; };
  }, [running, secondsLeft, phase]);

  return {
    settings,
    sessions,
    setSessions,
    phase,
    completedPomodoros,
    running,
    setRunning,
    taskLabel,
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
