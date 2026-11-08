import { useState, useEffect, Suspense, lazy, useCallback } from "react";
import { storageGet, storageSet } from "./lib/storage";
import type { Section } from "./types";
import { usePomodoroTimer } from "./lib/usePomodoroTimer";
import { HelpModal } from "./components/HelpModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { BackupModal } from "./components/BackupModal";
import { AccountButton, AccountModal } from "./components/AccountModal";

// Each section's code loads on demand. To make a new tab appear fast, the
// section the user had open last starts loading immediately (from a tiny
// synchronous localStorage hint), instead of after the async settings read.
//
// Sections whose code has already loaded render directly (no <Suspense>
// fallback): React 19 holds a shown fallback for at least ~300 ms, which made
// every new tab wait that long even though the code loads in a few ms.
const loadedModules: {
  editor?: typeof import("./sections/EditorSection");
  todos?: typeof import("./sections/TodoSection");
  pomodoro?: typeof import("./sections/PomodoroSection");
  habits?: typeof import("./sections/HabitSection");
  tracker?: typeof import("./sections/TimeTrackerSection");
  meetings?: typeof import("./sections/MeetingsSection");
  files?: typeof import("./sections/FilesSection");
} = {};
function once<K extends keyof typeof loadedModules>(key: K, load: () => Promise<NonNullable<(typeof loadedModules)[K]>>) {
  let p: Promise<NonNullable<(typeof loadedModules)[K]>> | undefined;
  return () =>
    (p ??= load().then((m) => {
      loadedModules[key] = m;
      return m;
    }));
}
const importers = {
  editor: once("editor", () => import("./sections/EditorSection")),
  todos: once("todos", () => import("./sections/TodoSection")),
  pomodoro: once("pomodoro", () => import("./sections/PomodoroSection")),
  habits: once("habits", () => import("./sections/HabitSection")),
  tracker: once("tracker", () => import("./sections/TimeTrackerSection")),
  meetings: once("meetings", () => import("./sections/MeetingsSection")),
  files: once("files", () => import("./sections/FilesSection")),
} satisfies Record<Section, () => Promise<unknown>>;

const SECTION_HINT_KEY = "prodli_sectionHint";
function rememberSectionHint(s: Section) {
  try {
    localStorage.setItem(SECTION_HINT_KEY, s);
  } catch {
    // storage unavailable — just no head start next time
  }
}
(() => {
  let hint: string | null = null;
  try {
    hint = localStorage.getItem(SECTION_HINT_KEY);
  } catch {
    // ignore
  }
  void (importers[(hint && hint in importers ? hint : "editor") as Section])();
})();

const EditorSection = lazy(() => importers.editor().then(m => ({ default: m.EditorSection })));
const TodoSection = lazy(() => importers.todos().then(m => ({ default: m.TodoSection })));
const PomodoroSection = lazy(() => importers.pomodoro().then(m => ({ default: m.PomodoroSection })));
const HabitSection = lazy(() => importers.habits().then(m => ({ default: m.HabitSection })));
const TimeTrackerSection = lazy(() => importers.tracker().then(m => ({ default: m.TimeTrackerSection })));
const MeetingsSection = lazy(() => importers.meetings().then(m => ({ default: m.MeetingsSection })));
const FilesSection = lazy(() => importers.files().then(m => ({ default: m.FilesSection })));

const SECTIONS: { key: Section; label: string; emoji: string; accent: string }[] = [
  { key: "editor", label: "Editor", emoji: "✍️", accent: "#FFD700" },
  { key: "todos", label: "To-Dos", emoji: "✅", accent: "#00BCD4" },
  { key: "pomodoro", label: "Pomodoro", emoji: "🍅", accent: "#FF6B6B" },
  { key: "habits", label: "Habits", emoji: "🎯", accent: "#66BB6A" },
  { key: "tracker", label: "Tracker", emoji: "⏱", accent: "#A78BFA" },
  { key: "meetings", label: "Meetings", emoji: "🎙️", accent: "#FF4FA3" },
  { key: "files", label: "Files", emoji: "📄", accent: "#FF9800" },
];

function LoadingFallback() {
  return (
    <div data-suspense-fallback style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 14, color: "#999" }}>
      Loading...
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>("editor");
  const [loaded, setLoaded] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const [showHelp, setShowHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const clearDroppedFile = useCallback(() => setDroppedFile(null), []);
  const closeAccount = useCallback(() => setShowAccount(false), []);

  const pomodoroTimer = usePomodoroTimer();

  useEffect(() => {
    Promise.all([
      storageGet<Section>("lastSection", "editor"),
      storageGet<string>("theme", "light"),
      storageGet<boolean>("hasSeenOnboarding", false),
    ]).then(async ([s, theme, seenOnboarding]) => {
      // Have the section's code ready before the first render (no fallback flash).
      await (importers[s] ?? importers.editor)().catch(() => {});
      setSection(s);
      rememberSectionHint(s);
      const dark = theme === "dark";
      setIsDark(dark);
      if (dark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      if (!seenOnboarding) setShowOnboarding(true);
      setLoaded(true);
    });
  }, []);

  const handleSectionChange = useCallback(async (s: Section) => {
    // Usually already prefetched (on hover); otherwise waits a few ms for the code.
    await importers[s]().catch(() => {});
    setSection(s);
    rememberSectionHint(s);
    await storageSet("lastSection", s);
  }, []);

  // Drop a file anywhere in ProdLi to preview it in Files. Without this,
  // Chrome would navigate the new tab away to the raw file.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onEnter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDraggingFile(true); } };
    const onLeave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (depth === 0) setDraggingFile(false); } };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDraggingFile(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        setDroppedFile(file);
        handleSectionChange("files");
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleSectionChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Escape" && showHelp) { setShowHelp(false); return; }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const map: Partial<Record<string, Section>> = { "1": "editor", "2": "todos", "3": "pomodoro", "4": "habits", "5": "tracker", "6": "meetings", "7": "files" };
        if (map[e.key]) { e.preventDefault(); handleSectionChange(map[e.key]!); return; }
      }

      if (e.key === " " && !e.ctrlKey && !e.metaKey && !isTyping && section === "pomodoro" && !showHelp) {
        e.preventDefault();
        pomodoroTimer.setRunning(!pomodoroTimer.running);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [section, showHelp, pomodoroTimer.running, pomodoroTimer.setRunning, handleSectionChange]);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    await storageSet("theme", next ? "dark" : "light");
  };

  const activeSection = SECTIONS.find(s => s.key === section)!;

  // Already-loaded sections render directly; others go through lazy/Suspense.
  const Editor = loadedModules.editor?.EditorSection ?? EditorSection;
  const Todos = loadedModules.todos?.TodoSection ?? TodoSection;
  const Pomodoro = loadedModules.pomodoro?.PomodoroSection ?? PomodoroSection;
  const Habits = loadedModules.habits?.HabitSection ?? HabitSection;
  const Tracker = loadedModules.tracker?.TimeTrackerSection ?? TimeTrackerSection;
  const Meetings = loadedModules.meetings?.MeetingsSection ?? MeetingsSection;
  const Files = loadedModules.files?.FilesSection ?? FilesSection;

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: "hsl(var(--background))", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 20, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--foreground))" }}>ProdLi</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "hsl(var(--background))",
      fontFamily: "Space Grotesk, Inter, sans-serif",
      overflow: "hidden",
    }}>
      <nav aria-label="Sections" style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: isDark ? "3px solid #FFD700" : "3px solid #000",
        background: "#000",
        height: 52,
        flexShrink: 0,
      }}>
        <div style={{
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "2px solid #333",
          flexShrink: 0,
        }}>
          <span style={{
            background: "#FFD700",
            color: "#000",
            fontWeight: 900,
            fontSize: 16,
            padding: "4px 10px",
            letterSpacing: "-0.02em",
            boxShadow: "2px 2px 0 #FFD700",
            border: "2px solid #FFD700",
          }}>ProdLi</span>
        </div>

        <div className="nav-tabs" style={{ display: "flex", flex: 1, minWidth: 0, overflowX: "auto" }}>
          {SECTIONS.map(s => (
            <button
              key={s.key}
              className="nav-tab"
              title={s.label}
              aria-current={section === s.key ? "page" : undefined}
              onClick={() => handleSectionChange(s.key)}
              onMouseEnter={() => void importers[s.key]()}
              style={{
                border: "none",
                borderRight: "2px solid #222",
                borderBottom: section === s.key ? `3px solid ${s.accent}` : "3px solid transparent",
                padding: "0 20px",
                background: section === s.key ? "#111" : "transparent",
                color: section === s.key ? s.accent : "#888",
                fontWeight: 800,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "inherit",
                transition: "all 0.15s",
                flexShrink: 0,
              }}
            >
              <span>{s.emoji}</span>
              <span className="nav-label">{s.label}</span>
              {s.key === "pomodoro" && pomodoroTimer.running && section !== "pomodoro" && (
                <span
                  className="timer-pulse"
                  title="Timer running"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#FF6B6B",
                    display: "inline-block",
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "stretch" }}>
          <AccountButton onClick={() => setShowAccount(true)} />
          <button
            onClick={() => setShowBackup(true)}
            title="Backup & Restore"
            aria-label="Backup and restore"
            style={{
              border: "none",
              borderLeft: "2px solid #222",
              background: "transparent",
              color: "#888",
              cursor: "pointer",
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 900,
              flexShrink: 0,
              fontFamily: "inherit",
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#FFD700")}
            onMouseLeave={e => (e.currentTarget.style.color = "#888")}
          >💾</button>
          <button
            onClick={() => setShowHelp(true)}
            title="Help & shortcuts"
            aria-label="Help and keyboard shortcuts"
            style={{
              border: "none",
              borderLeft: "2px solid #222",
              background: "transparent",
              color: "#888",
              cursor: "pointer",
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 900,
              flexShrink: 0,
              fontFamily: "inherit",
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#FFD700")}
            onMouseLeave={e => (e.currentTarget.style.color = "#888")}
          >?</button>
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              border: "none",
              borderLeft: "2px solid #222",
              background: "transparent",
              color: isDark ? "#FFD700" : "#888",
              cursor: "pointer",
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              transition: "color 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = isDark ? "#fff" : "#FFD700")}
            onMouseLeave={e => (e.currentTarget.style.color = isDark ? "#FFD700" : "#888")}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <LiveClock accent={activeSection.accent} />
        </div>
      </nav>

      <main id="main" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Suspense fallback={<LoadingFallback />}>
          {section === "editor" && <Editor />}
          {section === "todos" && <Todos />}
          {section === "pomodoro" && <Pomodoro {...pomodoroTimer} />}
          {section === "habits" && <Habits />}
          {section === "tracker" && <Tracker />}
          {section === "meetings" && <Meetings />}
          {section === "files" && <Files incomingFile={droppedFile} onIncomingHandled={clearDroppedFile} />}
        </Suspense>
      </main>

      {draggingFile && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "#FF9800", color: "#000", border: "3px solid #000", boxShadow: "6px 6px 0 #000", padding: "24px 36px", fontWeight: 900, fontSize: 20, textTransform: "uppercase" }}>
            📄 Drop to preview in Files
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}
      {showBackup && <BackupModal onClose={() => setShowBackup(false)} />}
      {showAccount && <AccountModal onClose={closeAccount} />}
    </div>
  );
}

function LiveClock({ accent }: { accent: string }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "0 20px",
      borderLeft: "2px solid #222",
      flexShrink: 0,
    }}>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: accent, letterSpacing: "-0.03em", fontFamily: "Space Mono, monospace" }}>{timeStr}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>{dateStr}</div>
      </div>
    </div>
  );
}
