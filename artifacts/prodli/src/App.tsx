import { useState, useEffect, Suspense, lazy, useCallback, useRef } from "react";
import { storageGet, storageRemove, storageSet } from "./lib/storage";
import type { Section } from "./types";
import { usePomodoroTimer } from "./lib/usePomodoroTimer";
import { OnboardingModal } from "./components/OnboardingModal";
import { ProfileMenu } from "./components/ProfileMenu";
import { SETTINGS_EVENT, SettingsModal, type SettingsTab } from "./components/Settings";
import { Logo } from "./components/Logo";
import { PENDING_UPGRADE_KEY, UPGRADE_EVENT, type PendingUpgrade } from "./lib/billing";
import { accountsEnabled } from "./lib/prodliAccount";
import { startSync } from "./lib/prodliSync";
import { dayKey, getTodaySettings } from "./lib/today";
import { GO_EVENT, GROUPS, MOBILE_TABS, SECTIONS, sectionByKey, sectionByShortcut } from "./sections/registry";
import { CommandPalette } from "./components/CommandPalette";
import { AskPanel } from "./components/AskPanel";
import { QuickAddModal } from "./components/QuickAdd";
import { addTask, captureFromUrl, type CaptureInput } from "./lib/capture";
import { isExtension, saveAndCloseWindow } from "./lib/tabSessions";
import { requestDailyNote } from "./lib/noteTemplates";
import { VOICE_TASKS_EVENT } from "./lib/voiceTasks";
import { VoiceTasksModal } from "./components/VoiceTasks";
import { IMPORT_TASKS_EVENT } from "./lib/importers/core";
import { undoImport, type ImportOutcome } from "./lib/importers/apply";
import { IMPORT_NOTES_EVENT } from "./lib/noteImporters/events";
import { undoNotesImport, type NotesImportOutcome } from "./lib/noteImporters/undo";
import { InPersonChip } from "./components/InPersonChip";
import { INBOX_KEY, OPEN_INBOX_KEY, type InboxAnswer } from "./lib/askPrompts";
import type { ChatTurn } from "./lib/ask";
import { ASK_EVENT } from "./lib/ask";
import { fileNameOf, readLocalFile } from "./lib/localFiles";
import { desktop } from "./lib/desktop";
import { parseDesktopCommand } from "./lib/desktopCommands";

// Each section's code loads on demand. To make a new tab appear fast, the
// section the user had open last starts loading immediately (from a tiny
// synchronous localStorage hint), instead of after the async settings read.
//
// Sections whose code has already loaded render directly (no <Suspense>
// fallback): React 19 holds a shown fallback for at least ~300 ms, which made
// every new tab wait that long even though the code loads in a few ms.
const loadedModules: {
  today?: typeof import("./sections/TodaySection");
  review?: typeof import("./sections/ReviewSection");
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
  today: once("today", () => import("./sections/TodaySection")),
  review: once("review", () => import("./sections/ReviewSection")),
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

// Import from other apps: loaded only when opened.
const WebDictationLazy = lazy(() => import("./components/WebDictation").then((m) => ({ default: m.WebDictation })));
const ImportTasksModal = lazy(() => import("./components/ImportTasks").then((m) => ({ default: m.ImportTasksModal })));
const ImportNotesModal = lazy(() => import("./components/ImportNotes").then((m) => ({ default: m.ImportNotesModal })));
const TodaySection = lazy(() => importers.today().then(m => ({ default: m.TodaySection })));
const ReviewSection = lazy(() => importers.review().then(m => ({ default: m.ReviewSection })));
const EditorSection = lazy(() => importers.editor().then(m => ({ default: m.EditorSection })));
const TodoSection = lazy(() => importers.todos().then(m => ({ default: m.TodoSection })));
const PomodoroSection = lazy(() => importers.pomodoro().then(m => ({ default: m.PomodoroSection })));
const HabitSection = lazy(() => importers.habits().then(m => ({ default: m.HabitSection })));
const TimeTrackerSection = lazy(() => importers.tracker().then(m => ({ default: m.TimeTrackerSection })));
const MeetingsSection = lazy(() => importers.meetings().then(m => ({ default: m.MeetingsSection })));
const FilesSection = lazy(() => importers.files().then(m => ({ default: m.FilesSection })));



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

  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Opened from a plan on prodli.com (?plan=…) or back from the checkout: the plans are what
  // matters, so the welcome tour waits for the next visit instead of covering them.
  const [arrivedForPlans] = useState(() => /[?&](plan=(pro|plus)|pro=|subscription_id=)/.test(window.location.search));
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const clearDroppedFile = useCallback(() => setDroppedFile(null), []);
  const closeSettings = useCallback(() => setSettingsTab(null), []);
  const [showPalette, setShowPalette] = useState(false);
  const [ask, setAsk] = useState<{ open: boolean; question?: string; turns?: ChatTurn[] }>({ open: false });
  // A scheduled prompt's notification was clicked: open Ask ProdLi with that answer.
  useEffect(() => {
    void (async () => {
      const id = await storageGet<string | null>(OPEN_INBOX_KEY, null);
      if (!id) return;
      await storageRemove(OPEN_INBOX_KEY);
      const item = (await storageGet<InboxAnswer[]>(INBOX_KEY, [])).find((x) => x.id === id);
      if (item) setAsk({ open: true, turns: [{ role: "user", text: item.question }, { role: "assistant", text: item.answer, sources: item.sources }] });
    })();
  }, []);
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; initial?: CaptureInput }>({ open: false });
  const [showMore, setShowMore] = useState(false);
  // Voice dictation in the web and desktop apps (the extension has its own, dictation/background.ts).
  const [webDictation, setWebDictation] = useState(() => !isExtension() && accountsEnabled());
  useEffect(() => {
    if (import.meta.env.VITE_E2E === "1" && isExtension()) void storageGet<boolean>("e2eWebDictation", false).then((v) => v && setWebDictation(true));
  }, []);
  const [toast, setToast] = useState<{ message: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("prodli_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const closeAsk = useCallback(() => setAsk({ open: false }), []);
  const closeQuickAdd = useCallback(() => setQuickAdd({ open: false }), []);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceListen, setVoiceListen] = useState(false);
  const closeVoice = useCallback(() => setVoiceOpen(false), []);
  useEffect(() => {
    // detail.listen: opened by the dictation shortcut, so start listening straight away.
    const open = (e: Event) => {
      setVoiceListen(!!(e as CustomEvent<{ listen?: boolean } | undefined>).detail?.listen);
      setVoiceOpen(true);
    };
    window.addEventListener(VOICE_TASKS_EVENT, open);
    return () => window.removeEventListener(VOICE_TASKS_EVENT, open);
  }, []);
  /** A short message at the bottom; with an action (Undo), it stays longer. */
  const flash = useCallback((m: string, action?: { label: string; run: () => void }) => {
    clearTimeout(toastTimer.current);
    setToast({ message: m, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 10_000 : 2600);
  }, []);
  const [importOpen, setImportOpen] = useState(false);
  const closeImport = useCallback(() => setImportOpen(false), []);
  useEffect(() => {
    const open = () => {
      setSettingsTab(null);
      setImportOpen(true);
    };
    window.addEventListener(IMPORT_TASKS_EVENT, open);
    return () => window.removeEventListener(IMPORT_TASKS_EVENT, open);
  }, []);
  const imported = useCallback(
    (out: ImportOutcome) => {
      const parts = [`Imported ${out.added} task${out.added === 1 ? "" : "s"}`];
      if (out.newLists) parts.push(`${out.newLists} new list${out.newLists === 1 ? "" : "s"}`);
      if (out.skipped) parts.push(`${out.skipped} already here`);
      flash(
        parts.join(" · "),
        out.added || out.newLists
          ? {
              label: "Undo",
              run: () => void undoImport(out.undo).then(() => flash("Import undone"), () => flash("Couldn't undo. Try again.")),
            }
          : undefined,
      );
    },
    [flash],
  );
  const [importNotesOpen, setImportNotesOpen] = useState(false);
  const closeImportNotes = useCallback(() => setImportNotesOpen(false), []);
  useEffect(() => {
    const open = () => {
      setSettingsTab(null);
      setImportNotesOpen(true);
    };
    window.addEventListener(IMPORT_NOTES_EVENT, open);
    return () => window.removeEventListener(IMPORT_NOTES_EVENT, open);
  }, []);
  const importedNotes = useCallback(
    (out: NotesImportOutcome) => {
      const parts = [`Imported ${out.added} note${out.added === 1 ? "" : "s"}`];
      if (out.skipped) parts.push(`${out.skipped} already here`);
      if (out.tooLarge) parts.push(`${out.tooLarge} too large`);
      if (out.picturesDropped) parts.push(`${out.picturesDropped} picture${out.picturesDropped === 1 ? "" : "s"} left out`);
      if (out.added) setSection("editor");
      flash(
        parts.join(" · "),
        out.added ? { label: "Undo", run: () => void undoNotesImport(out.undo).then(() => flash("Import undone"), () => flash("Couldn't undo. Try again.")) } : undefined,
      );
    },
    [flash],
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("prodli_sidebar_collapsed", c ? "0" : "1");
      } catch {
        // ignore
      }
      return !c;
    });

  // A local file opened in Chrome (background redirects file:// tabs here: ?section=files&file=…),
  // or, in the installed web app, a file opened with "Open with ProdLi".
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  useEffect(() => {
    const fileUrl = new URLSearchParams(location.search).get("file");
    if (fileUrl?.startsWith("file:///")) {
      readLocalFile(fileUrl).then(setDroppedFile, () => setFileProblem(`Couldn't open ${fileNameOf(fileUrl)}. ProdLi needs access to local files — see “Open files from anywhere in Chrome” below.`));
    }
    const lq = (window as unknown as { launchQueue?: { setConsumer(f: (p: { files?: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async (params) => {
      const handle = params.files?.[0];
      if (!handle) return;
      setDroppedFile(await handle.getFile());
      setSection("files");
    });
  }, []);

  // Upgrade to Pro: from anywhere in the app (lib/billing.ts openUpgrade), and
  // back from Dodo's checkout (/?pro=thanks) the account window shows the plan.
  useEffect(() => {
    const open = () => setSettingsTab("plan");
    const onSettings = (e: Event) => setSettingsTab((e as CustomEvent<{ tab?: SettingsTab }>).detail?.tab ?? "account");
    window.addEventListener(UPGRADE_EVENT, open);
    window.addEventListener(SETTINGS_EVENT, onSettings);
    // index.html#settings=dictation (opened by the background when something needs setting up).
    const hashTab = /^#settings=([a-z]+)$/.exec(window.location.hash)?.[1];
    if (hashTab) {
      setSettingsTab(hashTab as SettingsTab);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    // Dodo replaces our return URL's query with its own (subscription_id, payment_id,
    // status, email): show the plan, and take those (incl. the email) out of the address bar.
    const params = new URLSearchParams(window.location.search);
    // A plan picked on prodli.com (app.prodli.com/?plan=plus&period=yearly): the plans open and carry on to the checkout.
    const picked = params.get("plan");
    if (picked === "pro" || picked === "plus") {
      void storageSet(PENDING_UPGRADE_KEY, { plan: picked, interval: params.get("period") === "monthly" ? "monthly" : "yearly", at: Date.now() } satisfies PendingUpgrade);
      const url = new URL(window.location.href);
      url.searchParams.delete("plan");
      url.searchParams.delete("period");
      window.history.replaceState(null, "", url.toString());
      open();
    }
    const BILLING_PARAMS = ["pro", "subscription_id", "payment_id", "status", "email"];
    if (params.has("pro") || params.has("subscription_id")) {
      const url = new URL(window.location.href);
      for (const k of BILLING_PARAMS) url.searchParams.delete(k);
      window.history.replaceState(null, "", url.toString());
      open();
    }
    return () => {
      window.removeEventListener(UPGRADE_EVENT, open);
      window.removeEventListener(SETTINGS_EVENT, onSettings);
    };
  }, []);

  // Any section can open Ask ProdLi with a question (lib/ask.ts openAsk).
  useEffect(() => {
    // index.html#ask=… (the Quick add window's "? …").
    const hashAsk = /^#ask=(.*)$/.exec(window.location.hash)?.[1];
    if (hashAsk !== undefined) {
      let question = "";
      try {
        question = decodeURIComponent(hashAsk);
      } catch {
        /* a malformed link: just open Ask */
      }
      setAsk({ open: true, question: question.slice(0, 2000) || undefined });
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const onAsk = (e: Event) => setAsk({ open: true, question: (e as CustomEvent<{ question?: string }>).detail?.question });
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  // Any section can open another (sections/registry.ts openSection).
  const goRef = useRef<(s: Section) => void>(() => {});
  useEffect(() => {
    const onGo = (e: Event) => {
      const s = (e as CustomEvent<{ section?: Section }>).detail?.section;
      if (s && SECTIONS.some((x) => x.key === s)) goRef.current(s);
    };
    window.addEventListener(GO_EVENT, onGo);
    return () => window.removeEventListener(GO_EVENT, onGo);
  }, []);

  // Desktop app: files opened with ProdLi (File → Open, Open With, the dock icon) go to Files.
  useEffect(() => {
    const app = desktop();
    if (!app) return;
    const take = () =>
      void app.files.take().then((files) => {
        const f = files.at(-1);
        if (!f) return;
        setDroppedFile(new File([f.bytes as BlobPart], f.name, { type: f.type }));
        goRef.current("files");
      });
    take();
    return app.files.onAvailable(take);
  }, []);

  // Desktop app: the menu bar, tray / dock menu and global shortcuts send commands (lib/desktopCommands.ts).
  useEffect(
    () =>
      desktop()?.onCommand((raw) => {
        const cmd = parseDesktopCommand(raw);
        if (!cmd) return;
        if (cmd.kind === "go") goRef.current(cmd.section);
        else if (cmd.kind === "settings") setSettingsTab(cmd.tab);
        else if (cmd.kind === "search") setShowPalette(true);
        else if (cmd.kind === "ask") setAsk({ open: true });
        else if (cmd.kind === "quick-add") setQuickAdd({ open: true });
        else if (cmd.kind === "daily-note") void requestDailyNote().then(() => goRef.current("editor"));
        else if (cmd.kind === "record-call") {
          goRef.current("meetings");
          void import("./recorder/inPerson")
            .then((m) => m.startInPerson(m.callRecordingSupported() ? "call" : "room"))
            .catch((err: unknown) => flash(err instanceof Error ? err.message : "Recording couldn't start."));
        }
      }),
    [],
  );

  // Shared from another app (phone share sheet → web app share target).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shared = captureFromUrl(location.search);
    if (shared || params.has("quickadd")) setQuickAdd({ open: true, initial: shared ?? undefined });
    if (shared || params.has("quickadd")) history.replaceState(null, "", location.pathname);
  }, []);

  const pomodoroTimer = usePomodoroTimer();

  // ProdLi account sync (one open ProdLi page leads; the rest stand by).
  useEffect(() => (accountsEnabled() ? startSync() : undefined), []);

  useEffect(() => {
    Promise.all([
      storageGet<Section>("lastSection", "editor"),
      storageGet<string>("theme", "light"),
      storageGet<boolean>("hasSeenOnboarding", false),
      getTodaySettings(),
      storageGet<string | null>("lastTodayOpen", null),
    ]).then(async ([last, theme, seenOnboarding, todaySettings, lastTodayOpen]) => {
      // Assistant mode: the first ProdLi tab of each day opens on Today.
      let s = last;
      // App shortcut / link: ?section=today
      const urlSection = new URLSearchParams(location.search).get("section");
      const todayStr = dayKey();
      if (lastTodayOpen !== todayStr) {
        if (seenOnboarding && lastTodayOpen !== null && todaySettings.startOnToday) s = "today";
        void storageSet("lastTodayOpen", todayStr);
      }
      if (urlSection && urlSection in importers) {
        s = urlSection as Section;
        history.replaceState(null, "", location.pathname);
      }
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
      if (!seenOnboarding && !arrivedForPlans) setShowOnboarding(true);
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
  goRef.current = (s) => void handleSectionChange(s);

  // Drop a file anywhere in ProdLi to preview it in Files. Without this,
  // Chrome would navigate the new tab away to the raw file.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    // The import window takes its own drops.
    const importing = () => !!document.querySelector('[data-testid="import-tasks"]');
    // Pictures dragged over a note go into the note (the editor handles that drop).
    const imageOverNote = (e: DragEvent) => !!(e.target as Element | null)?.closest?.(".ProseMirror") && Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === "file" && i.type.startsWith("image/"));
    const onEnter = (e: DragEvent) => { if (hasFiles(e) && !importing() && !imageOverNote(e)) { depth++; setDraggingFile(true); } };
    const onLeave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (depth === 0) setDraggingFile(false); } };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return; // e.g. a picture the note editor already took
      if (importing()) {
        e.preventDefault();
        return;
      }
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

      // "?" anywhere outside a text field: Help & shortcuts.
      if (e.key === "?" && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setSettingsTab("help"); return; }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        // Ctrl/⌘+K: command palette (inside a note it stays the editor's link shortcut).
        if (e.key.toLowerCase() === "k" && !target.closest?.(".ProseMirror")) { e.preventDefault(); setShowPalette(true); return; }
        const s = sectionByShortcut(e.key);
        if (s) { e.preventDefault(); handleSectionChange(s.key); return; }
      }

      if (e.key === " " && !e.ctrlKey && !e.metaKey && !isTyping && section === "pomodoro" && !settingsTab) {
        e.preventDefault();
        pomodoroTimer.setRunning(!pomodoroTimer.running);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [section, settingsTab, pomodoroTimer.running, pomodoroTimer.setRunning, handleSectionChange]);

  const setTheme = async (next: boolean) => {
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    await storageSet("theme", next ? "dark" : "light");
  };
  const toggleTheme = () => setTheme(!isDark);

  const activeSection = sectionByKey(section);

  // Already-loaded sections render directly; others go through lazy/Suspense.
  const Today = loadedModules.today?.TodaySection ?? TodaySection;
  const Review = loadedModules.review?.ReviewSection ?? ReviewSection;
  const Editor = loadedModules.editor?.EditorSection ?? EditorSection;
  const Todos = loadedModules.todos?.TodoSection ?? TodoSection;
  const Pomodoro = loadedModules.pomodoro?.PomodoroSection ?? PomodoroSection;
  const Habits = loadedModules.habits?.HabitSection ?? HabitSection;
  const Tracker = loadedModules.tracker?.TimeTrackerSection ?? TimeTrackerSection;
  const Meetings = loadedModules.meetings?.MeetingsSection ?? MeetingsSection;
  const Files = loadedModules.files?.FilesSection ?? FilesSection;

  const paletteActions = {
    go: (s: Section) => void handleSectionChange(s),
    ask: (question?: string) => setAsk({ open: true, question }),
    addTask: (title: string) => void addTask({ title, smart: true }).then((t) => flash(`Added to-do: ${t.title}${t.dueDate ? ` · due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}` : ""}${t.repeat ? " · repeats" : ""}`)),
    quickAdd: () => setQuickAdd({ open: true }),
    voiceTasks: () => {
      setVoiceListen(false);
      setVoiceOpen(true);
    },
    importTasks: () => setImportOpen(true),
    importNotes: () => setImportNotesOpen(true),
    recordScreen: () => void import("./screenrec/open").then((m) => m.openRecorder()),
    dailyNote: () => void requestDailyNote().then(() => handleSectionChange("editor")),
    saveTabs: () => void saveAndCloseWindow().then(flash, () => flash("Couldn't save the tabs. Try again.")),
    toggleTheme: () => void toggleTheme(),
    account: () => setSettingsTab("account"),
    backup: () => setSettingsTab("data"),
    help: () => setSettingsTab("help"),
    settings: () => setSettingsTab("account"),
    flash: (m: string) => flash(m),
  };

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: "hsl(var(--background))", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Logo size={32} />
      </div>
    );
  }

  const navButton = (s: (typeof SECTIONS)[number], className = "nav-tab") => (
    <button
      key={s.key}
      className={className}
      title={collapsed ? `${s.label} (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}${s.shortcut})` : s.label}
      aria-current={section === s.key ? "page" : undefined}
      onClick={() => {
        setShowMore(false);
        void handleSectionChange(s.key);
      }}
      onMouseEnter={() => void importers[s.key]()}
      style={{ ["--accent" as string]: s.accent }}
    >
      <span className="side-icon" aria-hidden>{s.emoji}</span>
      <span className="side-label">{s.label}</span>
      {s.key === "pomodoro" && pomodoroTimer.running && section !== "pomodoro" && <span className="timer-pulse nav-dot" title="Timer running" />}
    </button>
  );

  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`} style={{ ["--accent" as string]: activeSection.accent }}>
      <nav aria-label="Sections" className="app-sidebar">
        <div className="side-brand">
          <Logo compact={collapsed} />
          <button className="side-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? "»" : "«"}
          </button>
        </div>
        <button className="side-btn side-ask" onClick={() => setAsk({ open: true })} title="Ask ProdLi (AI assistant)">
          <span className="side-icon" aria-hidden>✨</span>
          <span className="side-label">Ask ProdLi</span>
        </button>
        <button className="side-btn side-search" onClick={() => setShowPalette(true)} title="Search and commands">
          <span className="side-icon" aria-hidden>🔎</span>
          <span className="side-label">Search</span>
          <kbd className="side-kbd">{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        </button>

        <div className="nav-tabs">
          {GROUPS.map((g) => (
            <div key={g.id} className="side-group" role="group" aria-label={g.label}>
              <div className="side-group-label">{g.label}</div>
              {SECTIONS.filter((s) => s.group === g.id).map((s) => navButton(s))}
            </div>
          ))}
        </div>

        <div className="side-bottom">
          <button className="side-btn" onClick={() => setQuickAdd({ open: true })} title="Quick add a to-do or note">
            <span className="side-icon" aria-hidden>➕</span>
            <span className="side-label">Quick add</span>
          </button>
          <ProfileMenu variant="sidebar" isDark={isDark} onToggleTheme={() => void toggleTheme()} onSignedOut={flash} />
          <LiveClock accent={activeSection.accent} />
        </div>
      </nav>

      {/* Phones: slim top bar + bottom tabs (the sidebar is hidden). */}
      <header className="mobile-topbar">
        <Logo size={24} />
        <span className="mobile-title">{activeSection.emoji} {activeSection.label}</span>
        <button className="mobile-icon" onClick={() => setQuickAdd({ open: true })} aria-label="Quick add">➕</button>
        <ProfileMenu variant="topbar" isDark={isDark} onToggleTheme={() => void toggleTheme()} onSignedOut={flash} />
      </header>

      <main id="main" className="app-main">
        <Suspense fallback={<LoadingFallback />}>
          {section === "today" && <Today onAsk={(question) => setAsk({ open: true, question })} />}
          {section === "review" && <Review onAsk={(question) => setAsk({ open: true, question })} />}
          {section === "editor" && <Editor />}
          {section === "todos" && <Todos />}
          {section === "pomodoro" && <Pomodoro {...pomodoroTimer} />}
          {section === "habits" && <Habits />}
          {section === "tracker" && <Tracker />}
          {section === "meetings" && <Meetings />}
          {section === "files" && <Files incomingFile={droppedFile} onIncomingHandled={clearDroppedFile} incomingError={fileProblem} />}
        </Suspense>
      </main>

      <nav aria-label="Sections (phone)" className="mobile-tabbar">
        {MOBILE_TABS.map((k) => navButton(sectionByKey(k), "tab-btn"))}
        <button className="tab-btn" onClick={() => setAsk({ open: true })}>
          <span className="side-icon" aria-hidden>✨</span>
          <span className="side-label">Ask</span>
        </button>
        <button className="tab-btn" onClick={() => setShowMore(true)} aria-current={!MOBILE_TABS.includes(section) ? "page" : undefined} aria-haspopup="dialog">
          <span className="side-icon" aria-hidden>☰</span>
          <span className="side-label">More</span>
        </button>
      </nav>

      {showMore && (
        <div role="dialog" aria-modal="true" aria-label="More" className="more-sheet-backdrop" onClick={() => setShowMore(false)}>
          <div className="more-sheet" onClick={(e) => e.stopPropagation()}>
            {GROUPS.map((g) => (
              <div key={g.id} className="side-group">
                <div className="side-group-label">{g.label}</div>
                <div className="more-grid">{SECTIONS.filter((s) => s.group === g.id).map((s) => navButton(s, "more-item"))}</div>
              </div>
            ))}
            <div className="more-grid" style={{ marginTop: 10 }}>
              <button className="more-item" onClick={() => { setShowMore(false); setShowPalette(true); }}><span className="side-icon">🔎</span><span className="side-label">Search</span></button>
              <button className="more-item" onClick={() => { setShowMore(false); setSettingsTab("account"); }}><span className="side-icon">⚙️</span><span className="side-label">Settings</span></button>
              <button className="more-item" onClick={() => { setShowMore(false); setSettingsTab("help"); }}><span className="side-icon">?</span><span className="side-label">Help</span></button>
              <button className="more-item" onClick={() => { setShowMore(false); void toggleTheme(); }}><span className="side-icon">{isDark ? "☀️" : "🌙"}</span><span className="side-label">{isDark ? "Light" : "Dark"}</span></button>
            </div>
          </div>
        </div>
      )}

      {draggingFile && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "#FF9800", color: "#000", border: "3px solid #000", boxShadow: "6px 6px 0 #000", padding: "24px 36px", fontWeight: 900, fontSize: 20, textTransform: "uppercase" }}>
            📄 Drop to preview in Files
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="app-toast" data-testid="app-toast">
          {toast.message}
          {toast.action && (
            <button
              data-testid="toast-action"
              onClick={() => {
                const run = toast.action!.run;
                setToast(null);
                run();
              }}
              style={{ marginLeft: 12, border: "2px solid #FFD700", background: "#FFD700", color: "#000", fontWeight: 900, fontSize: 12, textTransform: "uppercase", padding: "2px 10px", cursor: "pointer", fontFamily: "inherit" }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
      {webDictation && (
        <Suspense fallback={null}>
          <WebDictationLazy />
        </Suspense>
      )}
      {showPalette && <CommandPalette actions={paletteActions} onClose={() => setShowPalette(false)} isDark={isDark} />}
      {ask.open && <AskPanel onClose={closeAsk} initialQuestion={ask.question} initialTurns={ask.turns} />}
      {voiceOpen && <VoiceTasksModal onClose={closeVoice} onDone={flash} autoListen={voiceListen} />}
      {importOpen && (
        <Suspense fallback={null}>
          <ImportTasksModal onClose={closeImport} onDone={imported} />
        </Suspense>
      )}
      {importNotesOpen && (
        <Suspense fallback={null}>
          <ImportNotesModal onClose={closeImportNotes} onDone={importedNotes} />
        </Suspense>
      )}
      {section !== "meetings" && <InPersonChip onOpen={() => void handleSectionChange("meetings")} />}
      {quickAdd.open && <QuickAddModal initial={quickAdd.initial} onClose={closeQuickAdd} onSaved={flash} />}
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}
      {settingsTab && <SettingsModal tab={settingsTab} onTab={setSettingsTab} onClose={closeSettings} isDark={isDark} setDark={(d) => void setTheme(d)} pomodoro={{ settings: pomodoroTimer.settings, save: pomodoroTimer.saveSettings }} />}
    </div>
  );
}

function LiveClock({ accent }: { accent: string }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="nav-clock side-clock" aria-hidden>
      <div style={{ fontSize: 18, fontWeight: 900, color: accent, letterSpacing: "-0.03em", fontFamily: "Space Mono, monospace" }}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="side-label" style={{ fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>{time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
    </div>
  );
}
