// Settings: one window with a side menu (like Momentum, Todoist or Notion),
// instead of separate Account, Backup and Help windows and a settings card on
// Today. Opened from the profile menu, the command palette, "?" (Help), or
// anywhere in the app with openSettings(tab).

import { DesktopSettingsSection } from "./DesktopSettings";
import { isDesktop } from "../lib/desktop";
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { PomodoroSettings } from "../lib/usePomodoroTimer";
import { accountsEnabled } from "../lib/prodliAccount";
import { onStorageChange, storageSet } from "../lib/storage";
import { DEFAULT_TODAY_SETTINGS, getTodaySettings, TODAY_SETTINGS_KEY } from "../lib/today";
import type { TodaySettings } from "../types";
import { AccountDataSection, AccountPanel, PlanPanel, box, sectionTitle } from "./AccountModal";
import { BackupModal } from "./BackupModal";
import { HelpModal, version } from "./HelpModal";
import { Logo } from "./Logo";
import { WritingStyleSection } from "./WritingStyle";
const DictationSettings = lazy(() => import("./DictationSettings").then((m) => ({ default: m.DictationSettings })));

export type SettingsTab = "account" | "plan" | "devices" | "data" | "appearance" | "desktop" | "writing" | "dictation" | "today" | "pomodoro" | "tracker" | "meetings" | "files" | "help" | "about";

// Each section's own settings, shown here as well (loaded only when opened).
const TrackerSettings = lazy(() => import("../sections/TimeTrackerSection").then((m) => ({ default: () => <m.TimeTrackerSection settingsOnly /> })));
const MeetingsSetup = lazy(() => import("../sections/MeetingsSection").then((m) => ({ default: () => <m.MeetingsSection setupOnly /> })));
const FilesOpenAnywhere = lazy(() => import("../sections/FilesSection").then((m) => ({ default: m.OpenAnywhereCard })));
const isExtensionPage = () => typeof chrome !== "undefined" && !!chrome.runtime?.id;

export const SETTINGS_EVENT = "prodli-settings";
/** Opens Settings at a tab from anywhere in the app (App.tsx listens). */
export function openSettings(tab: SettingsTab = "account"): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { tab } }));
}

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: string;
  group: string;
  serverOnly?: boolean;
  desktopOnly?: boolean;
  /** Only in the Chrome extension (needs its background and shortcuts). */
  extensionOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "account", label: "Account", icon: "👤", group: "Account" },
  { id: "plan", label: "Plan & usage", icon: "⭐", group: "Account", serverOnly: true },
  { id: "devices", label: "Sync & devices", icon: "🔄", group: "Account", serverOnly: true },
  { id: "data", label: "Backup & data", icon: "💾", group: "Account" },
  { id: "appearance", label: "Appearance", icon: "🎨", group: "Preferences" },
  { id: "desktop", label: "Desktop app", icon: "🖥", group: "Preferences", desktopOnly: true },
  { id: "writing", label: "Writing style", icon: "✍️", group: "Preferences", serverOnly: true },
  { id: "dictation", label: "Dictation", icon: "🎙", group: "Preferences", extensionOnly: true },
  { id: "today", label: "Today & planning", icon: "☀️", group: "Preferences" },
  { id: "pomodoro", label: "Pomodoro", icon: "🍅", group: "Sections" },
  { id: "tracker", label: "Time Tracker", icon: "⏱", group: "Sections" },
  { id: "meetings", label: "Meetings", icon: "🎙️", group: "Sections" },
  { id: "files", label: "Files", icon: "📄", group: "Sections" },
  { id: "help", label: "Help & shortcuts", icon: "❓", group: "Support" },
  { id: "about", label: "About", icon: "ℹ️", group: "Support" },
];

const navBtn = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  border: "none",
  borderLeft: `4px solid ${active ? "#FFD700" : "transparent"}`,
  background: active ? "hsl(var(--card))" : "transparent",
  color: "inherit",
  padding: "8px 12px",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: active ? 900 : 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const pill = (on: boolean): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: on ? "var(--nb-shadow-sm)" : "none",
  background: on ? "#FFD700" : "hsl(var(--card))",
  color: on ? "#000" : "hsl(var(--foreground))",
  padding: "8px 14px",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
});

function Heading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: "-0.01em" }}>{children}</h2>
      {sub && <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.75 }}>{sub}</p>}
    </div>
  );
}

function AppearanceSection({ isDark, setDark }: { isDark: boolean; setDark: (dark: boolean) => void }) {
  return (
    <div style={box}>
      <div style={sectionTitle}>Theme</div>
      <div role="radiogroup" aria-label="Theme" style={{ display: "flex", gap: 8 }}>
        <button role="radio" aria-checked={!isDark} style={pill(!isDark)} onClick={() => setDark(false)}>
          ☀️ Light
        </button>
        <button role="radio" aria-checked={isDark} style={pill(isDark)} onClick={() => setDark(true)}>
          🌙 Dark
        </button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Saved on this device.</div>
    </div>
  );
}

const timeInput: CSSProperties = { border: "var(--nb-border)", padding: "3px 6px", fontFamily: "inherit", background: "hsl(var(--background))", color: "inherit" };

function TodaySettingsSection() {
  const [s, setS] = useState<TodaySettings>(DEFAULT_TODAY_SETTINGS);
  useEffect(() => {
    void getTodaySettings().then(setS);
    return onStorageChange<TodaySettings>(TODAY_SETTINGS_KEY, (v) => setS({ ...DEFAULT_TODAY_SETTINGS, ...v }));
  }, []);
  const save = (patch: Partial<TodaySettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void storageSet(TODAY_SETTINGS_KEY, next);
  };
  const ext = typeof chrome !== "undefined" && !!chrome.alarms;
  const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600, flexWrap: "wrap" };
  return (
    <div style={{ display: "grid", gap: 16 }} data-testid="today-settings">
      <div style={box}>
        <div style={sectionTitle}>Working day</div>
        <label style={row}>
          From <input type="time" value={s.workStart} onChange={(e) => save({ workStart: e.target.value })} aria-label="Work day starts" style={timeInput} /> to{" "}
          <input type="time" value={s.workEnd} onChange={(e) => save({ workEnd: e.target.value })} aria-label="Work day ends" style={timeInput} />
        </label>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Your daily brief and time blocks plan within these hours.</div>
      </div>
      <div style={box}>
        <div style={sectionTitle}>Daily brief</div>
        <label style={row}>
          <input type="checkbox" checked={s.autoBrief} onChange={(e) => save({ autoBrief: e.target.checked })} /> Write my brief automatically the first time I open Today
        </label>
        <label style={row}>
          <input type="checkbox" checked={s.startOnToday} onChange={(e) => save({ startOnToday: e.target.checked })} /> Open Today first each day
        </label>
      </div>
      {ext && (
        <div style={box}>
          <div style={sectionTitle}>Reminders</div>
          <label style={row}>
            <input type="checkbox" checked={s.reminder !== null} onChange={(e) => save({ reminder: e.target.checked ? "08:30" : null })} /> Morning reminder to plan my day
            {s.reminder !== null && <input type="time" value={s.reminder} onChange={(e) => save({ reminder: e.target.value })} aria-label="Reminder time" style={timeInput} />}
          </label>
          <label style={row}>
            <input type="checkbox" checked={s.blockReminders !== false} onChange={(e) => save({ blockReminders: e.target.checked })} /> Notify me when a time block starts
          </label>
          <label style={row}>
            <input type="checkbox" checked={s.prepReminders !== false} onChange={(e) => save({ prepReminders: e.target.checked })} /> Remind me 10 minutes before meetings that have prep (Pro)
          </label>
          <label style={row}>
            <input type="checkbox" checked={s.taskReminders !== false} onChange={(e) => save({ taskReminders: e.target.checked })} /> Remind me when a task with a time is due
          </label>
<label style={row}>
            <input type="checkbox" checked={!!s.nagReminders} disabled={s.taskReminders === false} onChange={(e) => save({ nagReminders: e.target.checked })} data-testid="nag-reminders" /> Keep reminding me every 10 minutes until I tick it off (up to 2 hours)
          </label>
        </div>
      )}
    </div>
  );
}

const numInput: CSSProperties = { border: "var(--nb-border)", padding: "6px 8px", width: 80, fontFamily: "inherit", fontSize: 14, fontWeight: 700, background: "hsl(var(--background))", color: "inherit" };

function PomodoroSettingsSection({ settings, save }: { settings: PomodoroSettings; save: (s: PomodoroSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const fields: { key: keyof PomodoroSettings; label: string; unit: string; max: number }[] = [
    { key: "workDuration", label: "Focus", unit: "minutes", max: 120 },
    { key: "shortBreak", label: "Short break", unit: "minutes", max: 60 },
    { key: "longBreak", label: "Long break", unit: "minutes", max: 60 },
    { key: "longBreakAfter", label: "Long break after", unit: "focus sessions", max: 10 },
  ];
  const changed = fields.some((f) => draft[f.key] !== settings[f.key]);
  return (
    <div style={box} data-testid="pomodoro-settings">
      <div style={sectionTitle}>Timer</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {fields.map((f) => (
          <label key={f.key} style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
            {f.label}
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
              <input type="number" min={1} max={f.max} value={draft[f.key]} onChange={(e) => (setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) })), setSaved(false))} style={numInput} />
              <span style={{ fontSize: 12, opacity: 0.75 }}>{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={pill(changed)} disabled={!changed} onClick={() => void save(draft).then(() => setSaved(true))}>
          Save
        </button>
        {saved && !changed && <span role="status" style={{ fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
      </div>
    </div>
  );
}

const loadingNote = <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>;

function AboutSection() {
  const link: CSSProperties = { textDecoration: "underline", fontWeight: 700 };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...box, justifyItems: "start" }}>
        <Logo size={32} />
        <div style={{ fontSize: 13 }}>Version {version()}</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Your personal assistant and productivity tools in every new tab.</div>
      </div>
      <div style={box}>
        <div style={sectionTitle}>Links</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <a href="https://prodli.com" target="_blank" rel="noopener noreferrer" style={link}>prodli.com</a>
          <a href="https://app.prodli.com" target="_blank" rel="noopener noreferrer" style={link}>Web app</a>
          <a href="https://prodli.com/privacy" target="_blank" rel="noopener noreferrer" style={link}>Privacy</a>
          <a href="https://prodli.com/terms" target="_blank" rel="noopener noreferrer" style={link}>Terms</a>
          <a href="mailto:contact@prodli.com" style={link}>contact@prodli.com</a>
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({
  tab,
  onTab,
  onClose,
  isDark,
  setDark,
  pomodoro,
}: {
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onClose: () => void;
  isDark: boolean;
  setDark: (dark: boolean) => void;
  pomodoro: { settings: PomodoroSettings; save: (s: PomodoroSettings) => Promise<void> };
}) {
  const tabs = TABS.filter((t) => (!t.serverOnly || accountsEnabled()) && (!t.desktopOnly || isDesktop()) && (!t.extensionOnly || (isExtensionPage() && !!chrome.commands)));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goSignIn = () => onTab("account");
  const groups = [...new Set(tabs.map((t) => t.group))];

  let body: ReactNode;
  switch (current.id) {
    case "account":
      body = (
        <>
          <Heading sub={accountsEnabled() ? "Your ProdLi account: sign in to sync between devices and app.prodli.com." : "Optional: sync through your own Google Drive."}>Account</Heading>
          <AccountPanel view="account" onSignIn={goSignIn} />
        </>
      );
      break;
    case "plan":
      body = (
        <>
          <Heading sub="Your plan and this month's AI allowance.">Plan & usage</Heading>
          <PlanPanel onSignIn={goSignIn} />
        </>
      );
      break;
    case "devices":
      body = (
        <>
          <Heading sub="What's synced, and where you're signed in.">Sync & devices</Heading>
          <AccountPanel view="devices" onSignIn={goSignIn} />
        </>
      );
      break;
    case "data":
      body = (
        <>
          <Heading sub="Save a copy of everything on this device, or restore one.">Backup & data</Heading>
          <div style={{ display: "grid", gap: 16 }}>
            <BackupModal embedded />
            <AccountDataSection />
          </div>
        </>
      );
      break;
    case "appearance":
      body = (
        <>
          <Heading>Appearance</Heading>
          <AppearanceSection isDark={isDark} setDark={setDark} />
        </>
      );
      break;
    case "desktop":
      body = (
        <>
          <Heading sub="How ProdLi runs on this computer.">Desktop app</Heading>
          <DesktopSettingsSection />
        </>
      );
      break;
    case "writing":
      body = (
        <>
          <Heading sub="How ✨ Improve and follow-up emails should sound.">Writing style</Heading>
          <WritingStyleSection />
        </>
      );
      break;
    case "dictation":
      body = (
        <Suspense fallback={<div style={{ fontWeight: 700 }}>Loading…</div>}>
          <DictationSettings />
        </Suspense>
      );
      break;
    case "today":
      body = (
        <>
          <Heading sub="Your daily brief, time blocks and reminders.">Today & planning</Heading>
          <TodaySettingsSection />
        </>
      );
      break;
    case "pomodoro":
      body = (
        <>
          <Heading sub="Focus and break lengths.">Pomodoro</Heading>
          <PomodoroSettingsSection settings={pomodoro.settings} save={pomodoro.save} />
        </>
      );
      break;
    case "tracker":
      body = (
        <>
          <Heading sub="Idle time, daily summary, site limits and sites not to track.">Time Tracker</Heading>
          {isExtensionPage() ? (
            <Suspense fallback={loadingNote}>
              <TrackerSettings />
            </Suspense>
          ) : (
            <div style={box}>
              <div style={{ fontSize: 13 }}>Time is tracked by the ProdLi Chrome extension; its settings are in the extension (Settings › Time Tracker).</div>
            </div>
          )}
        </>
      );
      break;
    case "meetings":
      body = (
        <>
          <Heading sub="AI summaries, the recorder, your microphone and on-device transcription.">Meetings</Heading>
          <Suspense fallback={loadingNote}>
            <MeetingsSetup />
          </Suspense>
        </>
      );
      break;
    case "files":
      body = (
        <>
          <Heading sub="Open Markdown, CSV, JSON and text files in ProdLi.">Files</Heading>
          {isExtensionPage() || isDesktop() ? (
            <Suspense fallback={loadingNote}>
              <FilesOpenAnywhere />
            </Suspense>
          ) : (
            <div style={box}>
              <div style={{ fontSize: 13 }}>Drop a file anywhere in ProdLi to preview it. In the installed web app, you can also open files with ProdLi from your computer's "Open with" menu.</div>
            </div>
          )}
        </>
      );
      break;
    case "help":
      body = (
        <>
          <Heading sub="How everything works, and every keyboard shortcut.">Help & shortcuts</Heading>
          <HelpModal embedded />
        </>
      );
      break;
    case "about":
      body = (
        <>
          <Heading>About ProdLi</Heading>
          <AboutSection />
        </>
      );
      break;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose} className="settings-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="settings-window">
        <div className="settings-head">
          <span style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚙️ Settings</span>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="settings-close">
            ×
          </button>
        </div>
        <div className="settings-body">
          <nav aria-label="Settings sections" className="settings-nav">
            {groups.map((g) => (
              <div key={g} className="settings-group">
                <div className="settings-group-label">{g}</div>
                {tabs
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <button key={t.id} style={navBtn(t.id === current.id)} aria-current={t.id === current.id ? "page" : undefined} onClick={() => onTab(t.id)} data-settings-tab={t.id}>
                      <span aria-hidden>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <section className="settings-content" data-testid={`settings-${current.id}`}>
            {body}
          </section>
        </div>
      </div>
    </div>
  );
}
