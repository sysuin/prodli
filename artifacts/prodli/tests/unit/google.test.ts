import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageGet, storageSet } from "../../src/lib/storage";
import * as google from "../../src/lib/google";

// A fake Google: chrome.identity + the Drive/userinfo HTTP endpoints.
let driveFile: { id: string; content: string; modifiedTime: string } | null;
let requests: { method: string; url: string; body?: string }[];
let token: string;

function installFakes(clientId = "123-abc.apps.googleusercontent.com") {
  driveFile = null;
  requests = [];
  token = "tok-1";
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: "test", getManifest: () => ({ oauth2: { client_id: clientId } }) },
    identity: {
      getAuthToken: vi.fn(async () => ({ token })),
      removeCachedAuthToken: vi.fn(async () => {}),
      clearAllCachedAuthTokens: vi.fn(async () => {}),
    },
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (url.includes("googleapis.com") && !url.includes("revoke") && auth !== `Bearer ${token}`) return new Response("{}", { status: 401 });
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) {
      return Response.json({ sub: "42", name: "Sunny", email: "sunny@example.com", picture: "https://example.com/a.png" });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return Response.json({ files: driveFile ? [{ id: driveFile.id, modifiedTime: driveFile.modifiedTime, size: String(driveFile.content.length) }] : [] });
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      const content = (init?.body as string).split("\r\n\r\n")[2].split("\r\n--")[0];
      const meta = JSON.parse((init?.body as string).split("\r\n\r\n")[1].split("\r\n")[0]);
      if (method === "POST") expect(meta).toMatchObject({ name: "prodli-backup.json", parents: ["appDataFolder"] });
      driveFile = { id: driveFile?.id ?? "file-1", content, modifiedTime: new Date().toISOString() };
      return Response.json({ id: driveFile.id });
    }
    if (url.includes("/drive/v3/files/") && url.includes("alt=media")) {
      return new Response(driveFile?.content ?? "", { status: driveFile ? 200 : 404 });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => installFakes());
afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("Google sign-in", () => {
  it("is off when the build has no client ID", () => {
    installFakes("__none__");
    expect(google.googleConfigured()).toBe(false);
  });

  it("signs in, saves the profile and turns on daily backup", async () => {
    const account = await google.signIn();
    expect(account).toMatchObject({ sub: "42", name: "Sunny", email: "sunny@example.com" });
    expect(await google.getAccount()).toMatchObject({ email: "sunny@example.com" });
    expect(await storageGet(google.AUTO_BACKUP_KEY, null)).toBe(true);
    expect(chrome.identity.getAuthToken).toHaveBeenCalledWith({ interactive: true, scopes: google.SCOPES });
  });

  it("explains a cancelled sign-in in plain words", async () => {
    (chrome.identity.getAuthToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("The user did not approve access."));
    await expect(google.signIn()).rejects.toThrow("Sign-in was cancelled.");
  });

  it("signs out: revokes the token and forgets the account", async () => {
    await google.signIn();
    await google.signOut();
    expect(await google.getAccount()).toBeNull();
    expect(requests.some((r) => r.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalled();
  });
});

describe("Google Drive backup", () => {
  it("creates the backup in the app-data folder, then updates it", async () => {
    await storageSet("todos", [{ id: "t1", title: "Ship it", completed: false, createdAt: "" }]);
    await storageSet("claudeApiKey", "sk-ant-secret");
    const first = await google.backupToDrive();
    expect(first.bytes).toBeGreaterThan(0);
    expect(requests.filter((r) => r.url.includes("/upload/")).map((r) => r.method)).toEqual(["POST"]);
    expect(driveFile?.content).toContain("Ship it");
    expect(driveFile?.content).not.toContain("sk-ant-secret");
    await google.backupToDrive();
    expect(requests.filter((r) => r.url.includes("/upload/")).map((r) => r.method)).toEqual(["POST", "PATCH"]);
    expect(await storageGet(google.LAST_BACKUP_KEY, null)).toMatchObject({ auto: false });
  });

  it("restores from Drive", async () => {
    await storageSet("todos", [{ id: "t1", title: "From Drive", completed: false, createdAt: "" }]);
    await google.backupToDrive();
    await storageSet("todos", []);
    expect(await google.restoreFromDrive()).toEqual({ ok: true });
    expect((await storageGet<{ title: string }[]>("todos", []))[0].title).toBe("From Drive");
  });

  it("says so when there's no backup yet", async () => {
    expect(await google.restoreFromDrive()).toMatchObject({ ok: false });
  });

  it("refreshes an expired token once", async () => {
    await google.signIn();
    token = "tok-2"; // old token now rejected with 401
    (chrome.identity.getAuthToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ token: "tok-1" }).mockResolvedValue({ token: "tok-2" });
    await google.backupToDrive();
    expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: "tok-1" });
  });

  it("auto-sync runs only when signed in, enabled and due (about hourly)", async () => {
    expect(await google.autoSyncIfDue()).toBe(false); // not signed in
    await google.signIn();
    expect(await google.autoSyncIfDue()).toBe(true);
    expect(await google.autoSyncIfDue()).toBe(false); // just ran
    expect(await google.autoSyncIfDue(Date.now() + 61 * 60_000)).toBe(true);
    await storageSet(google.AUTO_BACKUP_KEY, false);
    expect(await google.autoSyncIfDue(Date.now() + 48 * 3600_000)).toBe(false);
  });

  it("two computers: edits from both are merged and deletions propagate", async () => {
    const note = (id: string, title: string, minutes: number) => ({ id, title, content: `<p>${title}</p>`, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: new Date(Date.UTC(2026, 10, 8, 10, minutes)).toISOString() });
    // Computer A has notes a + shared, syncs first.
    await storageSet("notes", [note("a", "Only on A", 0), note("shared", "Shared v1", 0)]);
    await google.syncWithDrive();
    const computerA = { ...localStorage };
    // Computer B (fresh storage) has its own note and edits the shared note later.
    localStorage.clear();
    await storageSet("notes", [note("b", "Only on B", 5), note("shared", "Shared v2 from B", 10)]);
    const fromB = await google.syncWithDrive();
    expect(fromB.changes).toBeGreaterThan(0);
    let notes = await storageGet<{ id: string; title: string }[]>("notes", []);
    expect(notes.map((n) => n.id).sort()).toEqual(["a", "b", "shared"]);
    expect(notes.find((n) => n.id === "shared")?.title).toBe("Shared v2 from B");
    // B deletes note "a" (as the Editor does via the tombstone list), then syncs.
    await storageSet("notes", notes.filter((n) => n.id !== "a"));
    await storageSet("syncTombstones", { notes: { a: new Date().toISOString() } });
    await google.syncWithDrive();
    // Back on A: sync brings B's note and edit, and removes the deleted note.
    localStorage.clear();
    for (const [k, v] of Object.entries(computerA)) localStorage.setItem(k, v as string);
    await google.syncWithDrive();
    notes = await storageGet<{ id: string; title: string }[]>("notes", []);
    expect(notes.map((n) => n.id).sort()).toEqual(["b", "shared"]);
    expect(notes.find((n) => n.id === "shared")?.title).toBe("Shared v2 from B");
  });
});
