// Settings › Desktop app (only in the Mac / Windows app): start at login, what
// closing the window does, recording permissions, the Quick add shortcut.

import { useEffect, useState, type CSSProperties } from "react";
import { desktop, desktopPlatformName, type DesktopPrefs } from "../lib/desktop";
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
