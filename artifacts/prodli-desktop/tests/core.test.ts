import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, contentType, resolveAsset, securityHeaders } from "../src/core/assets";
import { isAppUrl, isExternalLink } from "../src/core/links";
import { appMenuTemplate, trayMenuTemplate, type MenuActions } from "../src/core/menu";
import { callbackPage, makePkce, platformName, readCallback, signInUrl } from "../src/core/signIn";
import { MIN_SIZE, restoreBounds } from "../src/core/windowState";
import { createHash } from "node:crypto";
import type { MenuItemConstructorOptions } from "electron";

const root = path.resolve("/app/dist/renderer");

describe("serving app://prodli", () => {
  it("maps files inside the renderer folder", () => {
    expect(resolveAsset(root, "app://prodli/assets/index-abc.js")).toBe(path.join(root, "assets/index-abc.js"));
    expect(resolveAsset(root, "app://prodli/assets/a%20b.css")).toBe(path.join(root, "assets/a b.css"));
  });
  it("sends the entry page for / and in-app routes", () => {
    expect(resolveAsset(root, "app://prodli/")).toBe(path.join(root, "index.desktop.html"));
    expect(resolveAsset(root, "app://prodli/?section=today#quick-add")).toBe(path.join(root, "index.desktop.html"));
    expect(resolveAsset(root, "app://prodli/today")).toBe(path.join(root, "index.desktop.html"));
  });
  it("never escapes the folder or serves another host", () => {
    for (const bad of ["app://prodli/../../etc/passwd.txt", "app://prodli/%2e%2e/%2e%2e/secret.json", "app://prodli/..%2fsecret.json", "app://prodli/a%5c..%5c..%5cx.js", "app://prodli/x%00.js", "app://evil/index.js", "https://prodli/index.js", "not a url"]) {
      const r = resolveAsset(root, bad);
      expect(r === null || r.startsWith(root + path.sep), bad).toBe(true);
    }
    expect(resolveAsset(root, "app://evil/index.js")).toBeNull();
    expect(resolveAsset(root, "app://prodli/x%00.js")).toBeNull();
  });
  it("types and headers", () => {
    expect(contentType("a.woff2")).toBe("font/woff2");
    expect(contentType("a.unknown")).toBe("application/octet-stream");
    const html = securityHeaders("https://app.prodli.com", "index.desktop.html");
    expect(html["Content-Security-Policy"]).toContain("connect-src 'self' https://app.prodli.com wss://app.prodli.com");
    expect(html["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(html["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(securityHeaders("https://app.prodli.com", "a.js")["Content-Security-Policy"]).toBeUndefined();
    expect(contentSecurityPolicy("http://localhost:8787")).toContain("ws://localhost:8787");
  });
});

describe("desktop sign-in", () => {
  it("PKCE: the challenge is SHA-256 of the verifier, in the shapes the server accepts", () => {
    const p = makePkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
    expect(makePkce().verifier).not.toBe(p.verifier);
  });
  it("opens the hand-off page with port, state and challenge", () => {
    const p = { verifier: "v", challenge: "c".repeat(43), state: "s".repeat(32) };
    const u = new URL(signInUrl("https://app.prodli.com/", 51000, p));
    expect(u.origin + u.pathname).toBe("https://app.prodli.com/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ desktop: "signin", port: "51000", state: p.state, challenge: p.challenge });
    expect(u.searchParams.has("verifier")).toBe(false);
  });
  it("reads the loopback callback", () => {
    const code = "pldc_" + "a".repeat(43);
    expect(readCallback("GET", `/callback?code=${code}&state=S1234567890123456`, "S1234567890123456")).toEqual({ kind: "code", code });
    expect(readCallback("GET", "/favicon.ico", "S")).toEqual({ kind: "ignore" });
    expect(readCallback("POST", `/callback?code=${code}&state=S`, "S")).toEqual({ kind: "ignore" });
    expect(readCallback("GET", `/callback?code=${code}&state=other`, "S").kind).toBe("error");
    expect(readCallback("GET", `/callback?code=<script>&state=S`, "S").kind).toBe("error");
  });
  it("the browser page escapes its message", () => {
    expect(callbackPage(false, `<img src=x onerror=alert(1)>`)).not.toContain("<img");
  });
  it("platform names", () => {
    expect([platformName("darwin"), platformName("win32"), platformName("linux")]).toEqual(["mac", "windows", "linux"]);
  });
});

describe("links", () => {
  it("only http(s) and mailto go to the browser", () => {
    expect(isExternalLink("https://prodli.com/privacy")).toBe(true);
    expect(isExternalLink("mailto:support@prodli.com")).toBe(true);
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "app://prodli/", "smb://host/share", "https://user:pw@evil.example", "ms-settings:privacy", "nonsense"]) expect(isExternalLink(bad), bad).toBe(false);
  });
  it("app pages are app://prodli only", () => {
    expect(isAppUrl("app://prodli/#quick-add")).toBe(true);
    expect(isAppUrl("app://evil/")).toBe(false);
    expect(isAppUrl("https://app.prodli.com/")).toBe(false);
  });
});

describe("window bounds", () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  it("keeps a saved place that's on a screen", () => {
    expect(restoreBounds({ x: 100, y: 80, width: 1000, height: 700 }, [screen])).toEqual({ x: 100, y: 80, width: 1000, height: 700 });
  });
  it("brings back a window from an unplugged monitor, centred on the main screen", () => {
    const b = restoreBounds({ x: 3000, y: 100, width: 1200, height: 800 }, [screen]);
    expect(b.x! + b.width).toBeLessThanOrEqual(1440);
    expect(b.x).toBe(Math.round((1440 - 1200) / 2));
  });
  it("first launch: default size, centred, never below the minimum", () => {
    const b = restoreBounds(null, [{ x: 0, y: 25, width: 800, height: 500 }]);
    expect(b.width).toBe(MIN_SIZE.width);
    expect(b.height).toBe(MIN_SIZE.height);
    expect(restoreBounds({ x: NaN, y: 0, width: 10, height: 10 }, [screen]).width).toBe(1280);
  });
});

describe("menus", () => {
  const calls: string[] = [];
  const a: MenuActions = { command: (c) => calls.push(c), quickAdd: () => calls.push("quick"), recordCall: () => calls.push("record"), openFile: () => calls.push("open-file"), openWindow: () => calls.push("open"), openExternal: (u) => calls.push(u), quit: () => calls.push("quit") };
  const flat = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
  const byLabel = (items: MenuItemConstructorOptions[], label: string) => flat(items).find((i) => i.label === label)!;

  it("Mac has the ProdLi app menu with Settings ⌘, ; Windows puts Settings and Exit in File", () => {
    const mac = appMenuTemplate("darwin", a);
    expect(mac[0].label).toBe("ProdLi");
    expect(byLabel(mac, "Settings…").accelerator).toBe("CmdOrCtrl+,");
    const win = appMenuTemplate("win32", a);
    expect(win[0].label).toBe("File");
    expect(byLabel(win, "Exit")).toBeTruthy();
    expect(byLabel(win, "Settings")).toBeTruthy();
  });
  it("section shortcuts are shown but left to the page", () => {
    const today = byLabel(appMenuTemplate("darwin", a), "Today");
    expect(today.accelerator).toBe("CmdOrCtrl+0");
    expect(today.registerAccelerator).toBe(false);
    (today.click as () => void)();
    expect(calls).toContain("go:today");
  });
  it("dev tools only in development builds", () => {
    expect(flat(appMenuTemplate("darwin", a)).some((i) => i.role === "toggleDevTools")).toBe(false);
    expect(flat(appMenuTemplate("darwin", a, { dev: true })).some((i) => i.role === "toggleDevTools")).toBe(true);
  });
  it("the tray menu shows when a recording is running", () => {
    expect(byLabel(trayMenuTemplate(a, { recording: false }), "Record a Call or Meeting")).toBeTruthy();
    const rec = byLabel(trayMenuTemplate(a, { recording: true }), "Recording… (open Meetings)");
    (rec.click as () => void)();
    expect(calls.at(-1)).toBe("go:meetings");
  });
});

describe("menu bar timer", async () => {
  const { menuBarStatus, keepAwakeMode, DEFAULT_POMODORO_SETTINGS } = await import("../src/core/menuBar");
  const calls: string[] = [];
  const a: MenuActions = {
    command: (c) => calls.push(c), quickAdd: () => {}, recordCall: () => {}, openFile: () => {}, openWindow: () => {}, openExternal: () => {}, quit: () => {},
    timer: { start: () => calls.push("start"), pause: () => calls.push("pause"), resume: () => calls.push("resume"), stop: () => calls.push("stop") },
    toggleKeepAwake: () => calls.push("awake"),
  };
  const labels = (items: MenuItemConstructorOptions[]) => items.filter((i) => i.type !== "separator").map((i) => i.label);
  const click = (items: MenuItemConstructorOptions[], label: string) => (items.find((i) => i.label === label)!.click as () => void)();
  const NOW = new Date(2026, 10, 25, 10, 0, 0).getTime();
  const DAY = "2026-11-25";

  it("offers a focus session when nothing runs, and starts one", () => {
    const items = trayMenuTemplate(a, { recording: false, status: menuBarStatus({ now: NOW }), focusMinutes: 50, keepAwake: { manual: false, reason: null } });
    expect(labels(items).slice(0, 3)).toEqual(["Start a Focus Session (50 min)", "Keep Computer Awake", "Open ProdLi"]);
    click(items, "Start a Focus Session (50 min)");
    expect(calls.at(-1)).toBe("start");
  });

  it("shows a running session with Pause and Stop, then today's blocks and top task", () => {
    const status = menuBarStatus({
      timer: { phase: "work", running: true, endsAt: NOW + 25 * 60_000, remaining: 0, label: "", lastCompletedAt: null, lastCompletedPhase: null },
      settings: DEFAULT_POMODORO_SETTINGS,
      todos: [
        { id: "a", title: "Write the proposal", completed: false, createdAt: "", block: { day: DAY, start: "09:45" } },
        { id: "b", title: "Standup prep", completed: false, createdAt: "", block: { day: DAY, start: "10:30" } },
        { id: "c", title: "Call the bank", completed: false, createdAt: "", plannedFor: DAY },
      ],
      now: NOW,
    });
    const items = trayMenuTemplate(a, { recording: false, status, keepAwake: { manual: false, reason: "Staying awake during your focus session" } });
    expect(labels(items).slice(0, 8)).toEqual(["Focus until 10:25", "Pause", "Stop", "Now: Write the proposal (until 10:15)", "Next: Standup prep at 10:30 (in 30 min)", "Top task: Call the bank", "Keep Computer Awake", "Staying awake during your focus session"]);
    expect(items.find((i) => i.label === "Focus until 10:25")!.enabled).toBe(false);
    click(items, "Pause");
    click(items, "Top task: Call the bank");
    expect(calls.slice(-2)).toEqual(["pause", "go:todos"]);
  });

  it("a paused session offers Resume", () => {
    const status = menuBarStatus({ timer: { phase: "work", running: false, endsAt: null, remaining: 600, label: "", lastCompletedAt: null, lastCompletedPhase: null }, now: NOW });
    const items = trayMenuTemplate(a, { recording: false, status });
    expect(labels(items).slice(0, 3)).toEqual(["Focus paused, 10:00 left", "Resume", "Stop"]);
  });

  it("Keep Computer Awake is a checkbox; the automatic reason hides while it's on", () => {
    const on = trayMenuTemplate(a, { recording: false, status: menuBarStatus({ now: NOW }), keepAwake: { manual: true, reason: "Keeping your computer awake" } });
    const box = on.find((i) => i.label === "Keep Computer Awake")!;
    expect(box).toMatchObject({ type: "checkbox", checked: true });
    expect(labels(on)).not.toContain("Keeping your computer awake");
    (box.click as () => void)();
    expect(calls.at(-1)).toBe("awake");
  });

  it("keeps the screen on when asked; keeps the computer awake while recording or focusing if allowed", () => {
    expect(keepAwakeMode({ manual: true, auto: false, recording: false, focusing: false })?.kind).toBe("display");
    expect(keepAwakeMode({ manual: false, auto: true, recording: true, focusing: false })).toEqual({ kind: "system", reason: "Staying awake while recording" });
    expect(keepAwakeMode({ manual: false, auto: true, recording: false, focusing: true })?.kind).toBe("system");
    expect(keepAwakeMode({ manual: false, auto: false, recording: true, focusing: true })).toBeNull();
    expect(keepAwakeMode({ manual: false, auto: true, recording: false, focusing: false })).toBeNull();
  });
});

describe("desktop preferences", async () => {
  const { cleanPrefs, DEFAULT_PREFS } = await import("../src/core/prefs");
  it("keeps known boolean settings only", () => {
    expect(cleanPrefs(null)).toEqual(DEFAULT_PREFS);
    const dict = { dictateAnywhere: false, dictateShortcut: "Alt+Shift+Space" } as const;
    expect(cleanPrefs({ openAtLogin: true, keepRunning: "no", evil: 1 })).toEqual({ openAtLogin: true, keepRunning: true, callNudge: true, autoKeepAwake: true, ...dict });
    expect(cleanPrefs({ keepRunning: false, autoKeepAwake: false }, { openAtLogin: true, keepRunning: true, callNudge: false, autoKeepAwake: true, ...dict })).toEqual({ openAtLogin: true, keepRunning: false, callNudge: false, autoKeepAwake: false, ...dict });
  });
  it("dictation into any app is off until turned on, with a shortcut from the list", () => {
    expect(DEFAULT_PREFS.dictateAnywhere).toBe(false);
    expect(cleanPrefs({ dictateAnywhere: true, dictateShortcut: "F8" })).toMatchObject({ dictateAnywhere: true, dictateShortcut: "F8" });
    expect(cleanPrefs({ dictateShortcut: "Command+Q" }).dictateShortcut).toBe("Alt+Shift+Space");
  });
});

describe("dictation into any app", async () => {
  const { appCategory, appFieldKind, pasteCommand, pillBounds, shortcutLabel } = await import("../src/core/dictation");
  it("picks the style from the app in front", () => {
    expect(appCategory("Microsoft Outlook")).toBe("email");
    expect(appCategory("Mail")).toBe("email");
    expect(appCategory("Slack")).toBe("work");
    expect(appCategory("Microsoft Teams")).toBe("work");
    expect(appCategory("WhatsApp")).toBe("personal");
    expect(appCategory("Messages")).toBe("personal");
    expect(appCategory("Pages")).toBe("other");
    expect(appCategory("Outline")).toBe("other");
    expect(appCategory("")).toBe("other");
    expect(appFieldKind("Visual Studio Code")).toBe("code");
    expect(appFieldKind("Slack")).toBe("chat");
    expect(appFieldKind("Microsoft Outlook")).toBe("email");
  });
  it("presses paste the right way on each computer", () => {
    expect(pasteCommand("darwin")?.args.join(" ")).toContain('keystroke "v" using command down');
    expect(pasteCommand("win32")?.args.join(" ")).toContain("SendWait('^v')");
    expect(pasteCommand("linux")?.file).toBe("xdotool");
    expect(pasteCommand("aix")).toBeNull();
  });
  it("puts the pill at the bottom centre and labels shortcuts", () => {
    expect(pillBounds({ x: 0, y: 25, width: 1440, height: 875 })).toEqual({ x: 530, y: 25 + 875 - 72 - 24, width: 380, height: 72 });
    expect(shortcutLabel("Alt+Shift+Space", true)).toBe("⌥⇧Space");
    expect(shortcutLabel("CommandOrControl+Shift+Space", false)).toBe("Ctrl+Shift+Space");
  });
});

describe("opening files", async () => {
  const { filesFromArgv, isOpenablePath, mimeFor } = await import("../src/core/files");
  it("knows which files the viewer opens", () => {
    expect(isOpenablePath("/Users/a/Notes/plan.MD")).toBe(true);
    expect(isOpenablePath("C:\\data\\sales.csv")).toBe(true);
    expect(isOpenablePath("/Applications/Evil.app")).toBe(false);
    expect(isOpenablePath("/tmp/photo.png")).toBe(false);
    expect(isOpenablePath("/tmp/README")).toBe(false);
  });
  it("finds files in a Windows 'Open With' command line, ignoring switches", () => {
    expect(filesFromArgv(["C:\\ProdLi\\ProdLi.exe", "--hidden", "C:\\Users\\a\\todo.md", "C:\\x.exe"])).toEqual(["C:\\Users\\a\\todo.md"]);
    expect(filesFromArgv(["ProdLi"])).toEqual([]);
  });
  it("types", () => {
    expect(mimeFor("a.csv")).toBe("text/csv");
    expect(mimeFor("a.py")).toBe("text/plain");
  });
});

describe("update menu items", () => {
  const base: MenuActions = { command: () => {}, quickAdd: () => {}, recordCall: () => {}, openFile: () => {}, openWindow: () => {}, openExternal: () => {}, quit: () => {} };
  const labels = (items: MenuItemConstructorOptions[]): string[] => items.flatMap((i) => [String(i.label ?? ""), ...(Array.isArray(i.submenu) ? labels(i.submenu) : [])]);
  it("no update items without an update feed", () => {
    expect(labels(appMenuTemplate("darwin", base)).some((l) => /Update/.test(l))).toBe(false);
  });
  it("Check for Updates when enabled; Restart to Update once downloaded (also in the tray)", () => {
    expect(labels(appMenuTemplate("win32", { ...base, checkForUpdates: () => {} }))).toContain("Check for Updates…");
    const ready = { ...base, checkForUpdates: () => {}, restartToUpdate: { version: "1.2.0", run: () => {} } };
    expect(labels(appMenuTemplate("darwin", ready))).toContain("Restart to Update (1.2.0)");
    expect(labels(trayMenuTemplate(ready, { recording: false }))[0]).toBe("Restart to Update (1.2.0)");
  });
});

describe("noticing calls in other apps", async () => {
  const { callAppName, newCalls, parseMacInCall, parseWindowsMicInUse, reminderText } = await import("../src/core/callDetect");
  const reg = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe",
    "    LastUsedTimeStop    REG_QWORD    0x0",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe",
    "    LastUsedTimeStop    REG_QWORD    0x1db3c4f5a6b7c8d",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#ProdLi#ProdLi.exe",
    "    LastUsedTimeStop    REG_QWORD    0x0",
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Windows#System32#SoundRecorder.exe",
    "    LastUsedTimeStop    REG_QWORD    0x0",
  ].join("\r\n");
  it("Windows: call apps using the microphone now (not ProdLi, not other apps, not finished ones)", () => {
    expect(parseWindowsMicInUse(reg)).toEqual(["Microsoft Teams"]);
    expect(parseWindowsMicInUse("")).toEqual([]);
  });
  it("names apps, including browsers", () => {
    expect(callAppName("C:#Program Files#Google#Chrome#Application#chrome.exe")).toBe("your browser");
    expect(callAppName("C:#Program Files#ProdLi#ProdLi.exe")).toBeNull();
    expect(callAppName("C:#Tools#notepad.exe")).toBeNull();
    expect(callAppName("Microsoft.Windows.Search_cw5n1h2txyewy#SearchApp.exe")).toBeNull();
    expect(callAppName("C:#Users#a#AppData#Local#Arc#arc.exe")).toBe("your browser");
  });
  it("macOS: Zoom's in-meeting helper", () => {
    expect(parseMacInCall("launchd\nzoom.us\nCptHost\nFinder\n")).toEqual(["Zoom"]);
    expect(parseMacInCall("launchd\nzoom.us\n")).toEqual([]);
  });
  it("reminds once per call", () => {
    expect(newCalls([], ["Zoom"])).toEqual(["Zoom"]);
    expect(newCalls(["Zoom"], ["Zoom"])).toEqual([]);
    expect(reminderText(["Zoom"]).title).toBe("In a Zoom call?");
    expect(reminderText(["your browser"]).title).toBe("In a call in your browser?");
  });
});

describe("time in apps", async () => {
  const { addSample, cleanAppName, encodePowerShell, windowsForegroundScript } = await import("../src/core/appUsage");
  const { appsDayKey, sumDays, topApps } = await import("../../prodli/src/lib/appUsage");
  it("tidies names and skips system bits", () => {
    expect(cleanAppName("Slack\n")).toBe("Slack");
    expect(cleanAppName("Microsoft® Teams.exe")).toBe("Teams");
    expect(cleanAppName("loginwindow")).toBeNull();
    expect(cleanAppName("explorer")).toBeNull();
    expect(cleanAppName("  ")).toBeNull();
  });
  it("adds samples, capped (a long gap after sleep isn't counted as use)", () => {
    let day = addSample(undefined, "Slack", 10);
    day = addSample(day, "Slack", 9.6);
    day = addSample(day, "Zoom", 3600);
    expect(day).toEqual({ Slack: 20, Zoom: 60 });
  });
  it("sorts and sums", () => {
    expect(topApps({ A: 30, B: 90, C: 0 })).toEqual([{ app: "B", seconds: 90, share: 0.75 }, { app: "A", seconds: 30, share: 0.25 }]);
    expect(sumDays([{ A: 1 }, { A: 2, B: 3 }, undefined])).toEqual({ A: 3, B: 3 });
    expect(appsDayKey(new Date(2026, 0, 5))).toBe("apps_2026-01-05");
  });
  it("the Windows script is valid UTF-16 for -EncodedCommand and samples on an interval", () => {
    const script = windowsForegroundScript(5);
    expect(script).toContain("Start-Sleep -Seconds 5");
    expect(Buffer.from(encodePowerShell(script), "base64").toString("utf16le")).toBe(script);
  });
});
