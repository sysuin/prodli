// Settings › Desktop app (only in the Mac / Windows app): start at login, what
// closing the window does, recording permissions, dictation into any app, the
// Quick add shortcut.

import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_DICTATE_SHORTCUT, desktop, desktopPlatformName, DICTATE_SHORTCUTS, shortcutLabel, type DesktopPrefs } from "../lib/desktop";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import { CATEGORY_LABELS, CLEANUP_LABELS, cleanupLevel, DEFAULT_DICTATION_SETTINGS, DICTATION_SETTINGS_KEY, STYLE_LABELS, type CleanupLevel, type DictationSettings, type DictationStyle, type SiteCategory } from "../dictation/core";
import { box, sectionTitle } from "./AccountModal";

const row: CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const note: CSSProperties = { fontSize: 12, opacity: 0.75, fontWeight: 400, marginTop: 2 };
const link: CSSProperties = { border: "none", background: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 };

export function DesktopSettingsSection() {
  const app = desktop();
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [audio, setAudio] = useState<{ supported: boolean; permission: string } | null>(null);
  useEffect(() => {
    if (!app) return;
    void app.prefs.get().then(setPrefs);
    void app.systemAudio().then(setAudio);
  }, [app]);
  if (!app) return null;
  const mac = app.platform === "mac";
  const save = (patch: Partial<DesktopPrefs>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    void app.prefs.set(patch).then(setPrefs);
  };

  return (
    <div style={{ display: "grid", gap: 16 }} data-testid="desktop-settings">
      <div style={box}>
        <div style={sectionTitle}>Starting and closing</div>
        {prefs ? (
          <>
            <label style={row}>
              <input type="checkbox" checked={prefs.openAtLogin} onChange={(e) => save({ openAtLogin: e.target.checked })} />
              <span>
                Open ProdLi when you log in
                <div style={note}>Starts quietly in the {mac ? "menu bar" : "tray"}, so reminders and your daily brief are ready.</div>
              </span>
            </label>
            <label style={row}>
              <input type="checkbox" checked={prefs.keepRunning} onChange={(e) => save({ keepRunning: e.target.checked })} />
              <span>
                Keep running when the window is closed
                <div style={note}>Pomodoro, reminders, sync and recordings keep going. Quit from the {mac ? "menu bar icon or ⌘Q" : "tray icon or File → Exit"}.</div>
              </span>
            </label>
            <label style={row}>
              <input type="checkbox" checked={prefs.autoKeepAwake} onChange={(e) => save({ autoKeepAwake: e.target.checked })} />
              <span>
                Keep the computer awake while recording or focusing
                <div style={note}>It won't go to sleep during a recording or a Pomodoro focus session (the screen may still turn off). To keep the screen on too, use Keep Computer Awake in the {mac ? "menu bar" : "tray"} menu.</div>
              </span>
            </label>
          </>
        ) : (
          <span style={{ fontSize: 13, opacity: 0.7 }}>Loading…</span>
        )}
      </div>

      <div style={box}>
        <div style={sectionTitle}>Recording calls</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          🖥 <strong>Record a call</strong> (Meetings, or the {mac ? "menu bar" : "tray"} icon) records your computer's sound and your microphone, so it works with Zoom, Teams, Slack, Google Meet, FaceTime and any other app — no bot joins.
        </div>
        {prefs && (
          <label style={row}>
            <input type="checkbox" checked={prefs.callNudge} onChange={(e) => save({ callNudge: e.target.checked })} />
            <span>
              Remind me to record when a call starts
              <div style={note}>{mac ? "Notices Zoom and Webex meetings." : "Notices any call app using your microphone (Zoom, Teams, Slack, a browser…)."} Click the reminder to start recording.</div>
            </span>
          </label>
        )}
        {audio && !audio.supported && <div style={{ fontSize: 13 }}>This {desktopPlatformName(app.platform)} can't record the computer's sound (macOS 13 or later is needed); calls are recorded from your microphone.</div>}
        {audio?.supported && mac && audio.permission !== "granted" && (
          <div style={{ fontSize: 13 }}>
            To include the other people's voices, allow ProdLi in <strong>Screen &amp; System Audio Recording</strong>.{" "}
            <button style={link} onClick={() => void app.openSystemAudioSettings()}>
              Open System Settings
            </button>
          </div>
        )}
        {audio?.supported && (!mac || audio.permission === "granted") && <div style={{ fontSize: 13 }}>✓ Ready to record the computer's sound.</div>}
      </div>

      <DictateAnywhere prefs={prefs} save={save} />

      <div style={box}>
        <div style={sectionTitle}>Quick add</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Press <kbd>{mac ? "⌥ Option" : "Alt"}</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd> anywhere — in any app — to add a to-do or note without opening ProdLi.
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7 }}>ProdLi for {desktopPlatformName(app.platform)} {app.version}</div>
    </div>
  );
}

const APP_EXAMPLES: Record<SiteCategory, string> = {
  email: "Mail, Outlook, Spark",
  work: "Slack, Teams, Discord, Notion",
  personal: "WhatsApp, Messages, Telegram, Signal",
  other: "Everything else",
};

/** Dictate into any app: the switch, the shortcut, the clean-up and the style for each kind of app. */
function DictateAnywhere({ prefs, save }: { prefs: DesktopPrefs | null; save: (patch: Partial<DesktopPrefs>) => void }) {
  const app = desktop();
  const mac = app?.platform === "mac";
  const [status, setStatus] = useState<{ canPaste: boolean; shortcutTaken: boolean } | null>(null);
  const [settings, setSettings] = useState<DictationSettings>(DEFAULT_DICTATION_SETTINGS);
  const refresh = () => void app?.dictation?.status().then(setStatus);
  useEffect(() => {
    refresh();
    const load = (s: Partial<DictationSettings> | undefined) => setSettings({ ...DEFAULT_DICTATION_SETTINGS, ...(s ?? {}), styles: { ...DEFAULT_DICTATION_SETTINGS.styles, ...(s?.styles ?? {}) } });
    void storageGet<Partial<DictationSettings>>(DICTATION_SETTINGS_KEY, {}).then(load);
    // Back from System Settings: check the permission again.
    window.addEventListener("focus", refresh);
    const off = onStorageChange<Partial<DictationSettings>>(DICTATION_SETTINGS_KEY, load);
    return () => {
      window.removeEventListener("focus", refresh);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!app?.dictation || !prefs) return null;
  const on = !!prefs.dictateAnywhere;
  const shortcut = prefs.dictateShortcut ?? DEFAULT_DICTATE_SHORTCUT;
  const level = cleanupLevel(settings);
  const saveSettings = (patch: Partial<DictationSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void storageSet(DICTATION_SETTINGS_KEY, next);
  };
  const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 13, padding: "4px 6px" };

  return (
    <div style={box} data-testid="dictate-anywhere">
      <div style={sectionTitle}>🎙 Dictate into any app</div>
      <label style={row}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            save({ dictateAnywhere: e.target.checked });
            setTimeout(refresh, 300);
          }}
          data-testid="dictate-anywhere-on"
        />
        <span>
          Talk instead of typing in any app
          <div style={note}>Press the shortcut in Mail, Slack, Word or any other app, talk, then press it again. ProdLi cleans up what you said and pastes it where your cursor is. Uses your ProdLi account's dictation allowance.</div>
        </span>
      </label>
      {on && (
        <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Shortcut
            <select value={shortcut} onChange={(e) => (save({ dictateShortcut: e.target.value }), setTimeout(refresh, 300))} style={field} aria-label="Dictation shortcut">
              {DICTATE_SHORTCUTS.map((s) => (
                <option key={s} value={s}>
                  {shortcutLabel(s, mac)}
                  {s === "Alt+Shift+D" ? " (also the Chrome extension's)" : ""}
                </option>
              ))}
            </select>
            <span style={{ opacity: 0.75 }}>Esc cancels.</span>
          </label>
          {status?.shortcutTaken && (
            <div role="alert" style={{ fontWeight: 700 }}>
              Another app is using {shortcutLabel(shortcut, mac)}. Pick another shortcut.
            </div>
          )}
          {mac && status && !status.canPaste && (
            <div style={{ display: "grid", gap: 4 }}>
              <span>
                To paste for you, ProdLi needs <strong>Accessibility</strong> (System Settings → Privacy &amp; Security). Until then the text is copied and you press ⌘V.
              </span>
              <span>
                <button style={link} onClick={() => void app.dictation!.askToPaste().then(refresh)}>
                  Allow in System Settings
                </button>
              </span>
            </div>
          )}
          <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            <legend style={{ fontWeight: 800, padding: 0, marginBottom: 4 }}>Clean-up</legend>
            {(Object.keys(CLEANUP_LABELS) as CleanupLevel[]).map((l) => (
              <label key={l} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <input type="radio" name="desktop-dictate-cleanup" checked={level === l} onChange={() => saveSettings({ cleanup: l, polish: l !== "none" })} style={{ marginTop: 3 }} />
                <span>
                  <strong>{CLEANUP_LABELS[l].label}</strong> <span style={{ opacity: 0.8 }}>{CLEANUP_LABELS[l].detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: "grid", gap: 6 }}>
            <strong>Style for each kind of app</strong>
            {(Object.keys(CATEGORY_LABELS) as SiteCategory[]).map((c) => (
              <label key={c} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                <span>
                  {CATEGORY_LABELS[c].label.replace(" & tools", "")}
                  <span style={{ display: "block", fontSize: 11, opacity: 0.75 }}>{APP_EXAMPLES[c]}</span>
                </span>
                <select value={settings.styles[c]} onChange={(e) => saveSettings({ styles: { ...settings.styles, [c]: e.target.value as DictationStyle } })} style={field} aria-label={`Style for ${CATEGORY_LABELS[c].label}`}>
                  {(Object.keys(STYLE_LABELS) as DictationStyle[]).map((st) => (
                    <option key={st} value={st}>
                      {STYLE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div style={note}>In ProdLi's own text boxes the shortcut (and Alt+Shift+D) dictates there. Your dictionary and snippets are the same as for meeting notes and the extension. While you dictate, ProdLi briefly uses the clipboard to paste, then puts back what was on it.</div>
        </div>
      )}
    </div>
  );
}
