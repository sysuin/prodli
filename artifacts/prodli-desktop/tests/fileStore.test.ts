import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStore, type StoreCrypto } from "../src/core/fileStore";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prodli-store-"));
  file = path.join(dir, "data", "store.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Reversible stand-in for the OS keychain. */
const fakeKeychain = (key = "k1"): StoreCrypto => ({
  available: async () => true,
  encrypt: async (plain) => Buffer.from(`${key}|${plain}`).toString("base64"),
  decrypt: async (b64) => {
    const s = Buffer.from(b64, "base64").toString();
    if (!s.startsWith(`${key}|`)) throw new Error("wrong key");
    return s.slice(key.length + 1);
  },
});

describe("FileStore", () => {
  it("keeps values in memory, copies them, and writes them atomically", async () => {
    const s = await FileStore.open(file, { delayMs: 5 });
    s.set("notes", [{ id: "a" }]);
    const got = s.get("notes") as { id: string }[];
    got[0].id = "changed";
    expect(s.get("notes")).toEqual([{ id: "a" }]);
    await s.flush();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ format: 1, data: { notes: [{ id: "a" }] } });
    s.set("todos", []);
    await s.flush();
    expect(existsSync(`${file}.bak`)).toBe(true);
    const again = await FileStore.open(file);
    expect(again.getAll()).toEqual({ notes: [{ id: "a" }], todos: [] });
  });

  it("tells listeners about every change, including removals", async () => {
    const s = await FileStore.open(file);
    const seen: unknown[] = [];
    s.onChange((c) => seen.push(...c));
    s.set("a", 1);
    s.remove("a");
    s.remove("a"); // nothing to remove: no event
    s.set("b", undefined); // undefined = remove
    expect(seen).toEqual([
      { key: "a", newValue: 1 },
      { key: "a", newValue: undefined },
    ]);
  });

  it("encrypts secret keys on disk and reads them back", async () => {
    const s = await FileStore.open(file, { secretKeys: ["prodliSession"], crypto: fakeKeychain() });
    s.set("prodliSession", { token: "pls_secret" });
    s.set("notes", ["visible"]);
    await s.flush();
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("pls_secret");
    expect(raw).toContain("__prodliEncrypted");
    expect(raw).toContain("visible");
    const again = await FileStore.open(file, { secretKeys: ["prodliSession"], crypto: fakeKeychain() });
    expect(again.get("prodliSession")).toEqual({ token: "pls_secret" });
  });

  it("drops secrets it can't decrypt (another machine) instead of failing", async () => {
    const s = await FileStore.open(file, { secretKeys: ["prodliSession"], crypto: fakeKeychain("k1") });
    s.set("prodliSession", { token: "pls_secret" });
    s.set("notes", [1]);
    await s.flush();
    const other = await FileStore.open(file, { secretKeys: ["prodliSession"], crypto: fakeKeychain("k2") });
    expect(other.get("prodliSession")).toBeUndefined();
    expect(other.get("notes")).toEqual([1]);
  });

  it("without a keychain, secrets are stored as they are (like chrome.storage)", async () => {
    const s = await FileStore.open(file, { secretKeys: ["prodliSession"], crypto: { ...fakeKeychain(), available: async () => false } });
    s.set("prodliSession", { token: "pls_plain" });
    await s.flush();
    expect(readFileSync(file, "utf8")).toContain("pls_plain");
  });

  it("encrypts a secret that was stored plainly once a keychain is available", async () => {
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ format: 1, data: { prodliSession: { token: "pls_old" } } }));
    const f = path.join(dir, "store.json");
    const s = await FileStore.open(f, { secretKeys: ["prodliSession"], crypto: fakeKeychain() });
    expect(s.get("prodliSession")).toEqual({ token: "pls_old" });
    s.set("x", 1);
    await s.flush();
    expect(readFileSync(f, "utf8")).not.toContain("pls_old");
  });

  it("a damaged file is set aside and the backup is used", async () => {
    const s = await FileStore.open(file, { delayMs: 1 });
    s.set("notes", ["v1"]);
    await s.flush();
    s.set("notes", ["v2"]);
    await s.flush(); // .bak now has v1
    writeFileSync(file, "{ this is not json");
    const again = await FileStore.open(file);
    expect(again.recovered).toBe("backup");
    expect(again.get("notes")).toEqual(["v1"]);
    expect(readdir(dir).some((n) => n.startsWith("store.json.damaged-"))).toBe(true);
  });

  it("starts fresh when neither file can be read", async () => {
    const f = path.join(dir, "store.json");
    writeFileSync(f, "nope");
    const s = await FileStore.open(f);
    expect(s.recovered).toBe("fresh");
    expect(s.getAll()).toEqual({});
  });

  it("flushSync writes pending changes immediately (app quit)", async () => {
    const s = await FileStore.open(file, { delayMs: 10_000 });
    s.set("notes", ["quit"]);
    s.flushSync();
    expect(JSON.parse(readFileSync(file, "utf8")).data.notes).toEqual(["quit"]);
  });

  it("only JSON-like values are stored (functions and undefined fields vanish, like chrome.storage)", async () => {
    const s = await FileStore.open(file);
    s.set("x", { a: 1, b: undefined, d: new Date(0) });
    expect(s.get("x")).toEqual({ a: 1, d: "1970-01-01T00:00:00.000Z" });
  });
});

const readdir = (d: string) => readdirSync(path.join(d, "data"));
