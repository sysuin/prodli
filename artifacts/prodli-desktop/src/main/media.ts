// Microphone and "what the computer plays" (other apps' call audio) for
// recording any call: Zoom, Teams, Slack, FaceTime, a browser tab…
//
// The page asks with getDisplayMedia({ audio: true, video: true }); the app
// answers with the whole screen as video (dropped at once by the page) plus
// loopback audio. Windows supports loopback natively; on macOS 13+ Chromium
// captures system audio through ScreenCaptureKit with the switches in
// enableSystemAudioSwitches(). If a Mac can't, the stream simply has no audio
// track and the page records the microphone alone (and says so).
//
// Only the app's own pages get media; every other permission is refused.

import { app, desktopCapturer, ipcMain, session, shell, systemPreferences } from "electron";
import { IPC } from "../core/ipc";
import { isAppUrl } from "../core/links";
import { IS_DEV } from "./config";

/**
 * Development builds started with Chromium's fake media devices (tests/e2e.mjs):
 * no macOS permission prompts and no screen capture, so the microphone-only
 * path of "Record a call" runs unattended.
 */
const fakeMedia = () => IS_DEV && app.commandLine.hasSwitch("use-fake-device-for-media-stream");

/** Must run before the app is ready. */
export function enableSystemAudioSwitches(): void {
  if (process.platform === "darwin") {
    app.commandLine.appendSwitch("enable-features", "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride");
  }
}

const ALLOWED = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write", "fullscreen", "screen-wake-lock"]);

function macVersion(): number {
  if (process.platform !== "darwin") return 0;
  const [major] = process.getSystemVersion().split(".").map(Number);
  return major ?? 0;
}

export function systemAudioSupported(): boolean {
  return process.platform === "win32" || (process.platform === "darwin" && macVersion() >= 13);
}

export function setUpMedia(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = ALLOWED.has(permission) && isAppUrl(details.requestingUrl || wc.getURL());
    if (ok && permission === "media" && process.platform === "darwin" && !fakeMedia()) {
      const wantsMic = !("mediaTypes" in details) || (details.mediaTypes ?? []).includes("audio");
      if (wantsMic && systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
        void systemPreferences.askForMediaAccess("microphone").then(callback, () => callback(false));
        return;
      }
    }
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && isAppUrl(origin));

  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.securityOrigin || request.frame?.url || "") || fakeMedia()) return callback(null);
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }).then(
        (sources) => {
          const screen = sources[0];
          if (!screen) return callback(null);
          callback(systemAudioSupported() ? { video: screen, audio: "loopback" } : { video: screen });
        },
        () => callback(null),
      );
    },
    { useSystemPicker: false },
  );

  ipcMain.handle(IPC.systemAudio, () => {
    const supported = systemAudioSupported();
    const permission = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
    return { supported, permission };
  });
  ipcMain.handle(IPC.openSystemAudioSettings, async () => {
    if (process.platform === "darwin") await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    else if (process.platform === "win32") await shell.openExternal("ms-settings:privacy-microphone");
  });
}
