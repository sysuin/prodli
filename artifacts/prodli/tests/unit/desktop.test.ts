// The desktop app's pieces that live in the shared app code: the storage bridge
// backend, bearer auth for account requests, and the web app's sign-in hand-off.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge, StorageChange } from "../../src/lib/desktop";
import { handoffUrl, loopbackCallback, parseDesktopHandoff } from "../../src/lib/desktopHandoff";
import { onAnyStorageChange, onStorageChange, storageGet, storageGetAll, storageRemove, storageSet, StorageWriteError } from "../../src/lib/storage";

function fakeBridge(): DesktopBridge & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const listeners = new Set<(c: StorageChange[]) => void>();
  const emit = (c: StorageChange[]) => listeners.forEach((l) => l(c));
  return {
    data,
    platform: "mac",
    version: "1.0.0",
    initialTheme: null,
    storage: {
      get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
      getAll: async () => Object.fromEntries(data),
      set: async (k, v) => {
        if (k === "full") throw new Error("Disk full");
        data.set(k, structuredClone(v));
        emit([{ key: k, newValue: v }]);
      },
      remove: async (k) => {
        data.delete(k);
        emit([{ key: k, newValue: undefined }]);
      },
      onChanged: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    },
    account: { signIn: async () => ({ ok: true }), cancelSignIn: async () => {} },
    prefs: { get: async () => ({ openAtLogin: false, keepRunning: true }), set: async (p) => ({ openAtLogin: false, keepRunning: true, ...p }) },
    files: { take: async () => [], onAvailable: () => () => {}, openDialog: async () => {} },
    openExternal: async () => {},
    systemAudio: async () => ({ supported: true, permission: "granted" }),
    openSystemAudioSettings: async () => {},
    closeWindow: () => {},
    onCommand: () => () => {},
    setBadge: () => {},
    setRecording: () => {},
  };
}

afterEach(() => {
  delete window.prodliDesktop;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("storage in the desktop app", () => {
  it("reads and writes through the bridge, not localStorage", async () => {
    const b = fakeBridge();
    window.prodliDesktop = b;
    expect(await storageGet("notes", [])).toEqual([]);
    await storageSet("notes", [{ id: "n1" }]);
    expect(b.data.get("notes")).toEqual([{ id: "n1" }]);
    expect(localStorage.getItem("prodli_notes")).toBeNull();
    expect(await storageGet("notes", [])).toEqual([{ id: "n1" }]);
    expect(await storageGetAll()).toEqual({ notes: [{ id: "n1" }] });
    await storageRemove("notes");
    expect(await storageGet("notes", "gone")).toBe("gone");
  });

  it("reports changes to the key's listeners and to any-key listeners", async () => {
    window.prodliDesktop = fakeBridge();
    const seen: unknown[] = [];
    const keys: string[][] = [];
    const off = onStorageChange("todos", (v) => seen.push(v));
    const offAny = onAnyStorageChange((k) => keys.push(k));
    await storageSet("todos", [1]);
    await storageSet("habits", [2]);
    await storageRemove("todos");
    off();
    offAny();
    await storageSet("todos", [3]);
    expect(seen).toEqual([[1], undefined]);
    expect(keys).toEqual([["todos"], ["habits"], ["todos"]]);
  });

  it("a failed write is a StorageWriteError (so the UI shows 'couldn't save')", async () => {
    window.prodliDesktop = fakeBridge();
    await expect(storageSet("full", 1)).rejects.toBeInstanceOf(StorageWriteError);
  });
});

describe("account requests from the desktop app", () => {
  it("send the stored session as a bearer token, without cookies", async () => {
    vi.stubEnv("VITE_PRODLI_API", "https://app.prodli.com");
    const b = fakeBridge();
    b.data.set("prodliSession", { token: "pls_abc", expiresAt: Date.now() + 1000 });
    window.prodliDesktop = b;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { accountRequest } = await import("../../src/lib/prodliAccount");
    await accountRequest("/api/me");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.prodli.com/api/me");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer pls_abc");
    expect(init.credentials).toBe("omit");
  });

  it("signInFromDesktop returns the profile the app stored, or explains a cancel", async () => {
    const b = fakeBridge();
    window.prodliDesktop = b;
    const { signInFromDesktop } = await import("../../src/lib/prodliAccount");
    b.account.signIn = async () => {
      b.data.set("prodliAccount", { id: "u1", email: "d@example.com" });
      return { ok: true };
    };
    expect(await signInFromDesktop()).toMatchObject({ email: "d@example.com" });
    b.account.signIn = async () => ({ ok: false, error: "x", cancelled: true });
    await expect(signInFromDesktop()).rejects.toThrow("Sign-in was cancelled.");
  });
});

describe("web app: desktop sign-in hand-off", () => {
  const ok = { port: 51234, state: "s".repeat(24), challenge: "c".repeat(43) };

  it("parses a well-formed request and round-trips with the URL the app builds", () => {
    const url = new URL(handoffUrl("https://app.prodli.com/", ok));
    expect(url.origin).toBe("https://app.prodli.com");
    expect(parseDesktopHandoff(url.search)).toEqual(ok);
  });

  it("ignores other pages and malformed requests", () => {
    expect(parseDesktopHandoff("")).toBeNull();
    expect(parseDesktopHandoff("?section=today")).toBeNull();
    const bad = (over: Record<string, string>) => parseDesktopHandoff("?" + new URLSearchParams({ desktop: "signin", port: "51234", state: ok.state, challenge: ok.challenge, ...over }).toString());
    expect(bad({})).toEqual(ok);
    expect(bad({ port: "80" })).toBeNull();
    expect(bad({ port: "70000" })).toBeNull();
    expect(bad({ port: "5123a" })).toBeNull();
    expect(bad({ state: "short" })).toBeNull();
    expect(bad({ state: "s".repeat(20) + "<x>" })).toBeNull();
    expect(bad({ challenge: "c".repeat(42) })).toBeNull();
  });

  it("always calls back to the loopback address", () => {
    expect(loopbackCallback(ok, "pldc_a+b")).toBe(`http://127.0.0.1:51234/callback?code=pldc_a%2Bb&state=${ok.state}`);
  });
});

describe("desktop menu commands", async () => {
  const { parseDesktopCommand } = await import("../../src/lib/desktopCommands");
  it("understands the commands the menus send", () => {
    expect(parseDesktopCommand("go:today")).toEqual({ kind: "go", section: "today" });
    expect(parseDesktopCommand("settings")).toEqual({ kind: "settings", tab: "appearance" });
    expect(parseDesktopCommand("settings:help")).toEqual({ kind: "settings", tab: "help" });
    expect(parseDesktopCommand("quick-add")).toEqual({ kind: "quick-add" });
    expect(parseDesktopCommand("daily-note")).toEqual({ kind: "daily-note" });
  });
  it("ignores anything else", () => {
    for (const bad of ["go:nowhere", "go", "settings:root", "search:x", "rm -rf", "", 42, null]) expect(parseDesktopCommand(bad)).toBeNull();
  });
});
