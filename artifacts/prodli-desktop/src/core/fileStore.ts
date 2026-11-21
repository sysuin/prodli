// ProdLi's data on disk in the desktop app: one JSON file of key → value, the
// same keys the extension keeps in chrome.storage.local ("notes", "todos", …).
//
// - Everything is in memory; reads never touch the disk.
// - Writes are batched (a short delay) and atomic: the new file is written next
//   to the old one and renamed over it, and the previous version is kept as
//   .bak. A crash mid-write can never leave a half-written file behind, and a
//   damaged file is set aside (never deleted) and the backup is used instead.
// - Secret keys (the ProdLi session) are encrypted at rest with the OS keychain
//   (Electron's safeStorage, passed in as `crypto`). If they can't be
//   decrypted (another user / machine), they're dropped: you sign in again.
//   Without a keychain (some Linux desktops) they're stored as they are, like
//   the extension does in chrome.storage.
//
// No Electron imports, so it's tested with plain Node (tests/fileStore.test.ts).

import { closeSync, existsSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

export interface StoreCrypto {
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<string>; // base64
  decrypt(b64: string): Promise<string>;
}

export interface StoreChange {
  key: string;
  newValue: unknown;
}

const ENC = "__prodliEncrypted";
const FORMAT = 1;

interface FileShape {
  format: number;
  data: Record<string, unknown>;
}

const isSealed = (v: unknown): v is Record<typeof ENC, string> => !!v && typeof v === "object" && typeof (v as Record<string, unknown>)[ENC] === "string";

export class FileStore {
  private data = new Map<string, unknown>();
  /** Latest ciphertext of each secret key (what goes on disk). */
  private cipher = new Map<string, string>();
  private sealing = new Map<string, Promise<void>>();
  private encrypting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  private listeners = new Set<(changes: StoreChange[]) => void>();
  /** Set when the file on disk couldn't be read at start (for a one-time notice). */
  recovered: "backup" | "fresh" | null = null;

  private constructor(
    readonly file: string,
    private readonly secretKeys: ReadonlySet<string>,
    private readonly crypto: StoreCrypto | null,
    private readonly delayMs: number,
  ) {}

  static async open(file: string, opts: { secretKeys?: string[]; crypto?: StoreCrypto | null; delayMs?: number } = {}): Promise<FileStore> {
    const store = new FileStore(file, new Set(opts.secretKeys ?? []), opts.crypto ?? null, opts.delayMs ?? 150);
    store.encrypting = !!store.crypto && (await store.crypto.available().catch(() => false));
    await mkdir(path.dirname(file), { recursive: true });
    await store.load();
    return store;
  }

  private async readShape(p: string): Promise<FileShape | null> {
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(await readFile(p, "utf8")) as Partial<FileShape>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.data !== "object" || parsed.data === null) throw new Error("not a ProdLi store");
    return { format: parsed.format ?? FORMAT, data: parsed.data };
  }

  private async load(): Promise<void> {
    let shape: FileShape | null = null;
    try {
      shape = await this.readShape(this.file);
    } catch {
      // Damaged: keep it for inspection, fall back to the previous version.
      await rename(this.file, `${this.file}.damaged-${Date.now()}`).catch(() => {});
      try {
        shape = await this.readShape(`${this.file}.bak`);
        this.recovered = shape ? "backup" : "fresh";
      } catch {
        this.recovered = "fresh";
      }
    }
    for (const [k, v] of Object.entries(shape?.data ?? {})) {
      if (!isSealed(v)) {
        this.data.set(k, v);
        if (this.secretKeys.has(k) && this.encrypting) this.seal(k, v); // stored plainly before: encrypt it now
        continue;
      }
      if (!this.encrypting) continue; // can't read it here: sign in again
      try {
        this.data.set(k, JSON.parse(await this.crypto!.decrypt(v[ENC])));
        this.cipher.set(k, v[ENC]);
      } catch {
        // another user / machine's secret
      }
    }
  }

  private seal(key: string, value: unknown): void {
    const plain = JSON.stringify(value);
    const job = this.crypto!.encrypt(plain).then(
      (c) => {
        if (JSON.stringify(this.data.get(key)) === plain) this.cipher.set(key, c);
      },
      () => void this.cipher.delete(key),
    );
    this.sealing.set(key, job);
    void job.finally(() => this.sealing.get(key) === job && this.sealing.delete(key));
  }

  get(key: string): unknown {
    const v = this.data.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  getAll(): Record<string, unknown> {
    return structuredClone(Object.fromEntries(this.data));
  }

  /** Values must be JSON-like (what chrome.storage accepts). */
  set(key: string, value: unknown): void {
    if (value === undefined) return this.remove(key);
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    this.data.set(key, copy);
    if (this.secretKeys.has(key) && this.encrypting) {
      this.cipher.delete(key);
      this.seal(key, copy);
    }
    this.changed([{ key, newValue: structuredClone(copy) }]);
  }

  remove(key: string): void {
    if (!this.data.has(key)) return;
    this.data.delete(key);
    this.cipher.delete(key);
    this.changed([{ key, newValue: undefined }]);
  }

  onChange(cb: (changes: StoreChange[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(changes: StoreChange[]): void {
    this.dirty = true;
    for (const l of this.listeners) l(changes);
    if (!this.timer) this.timer = setTimeout(() => void this.flush().catch(() => {}), this.delayMs);
  }

  private serialize(): string {
    const data: Record<string, unknown> = {};
    for (const [k, v] of this.data) {
      if (!this.secretKeys.has(k) || !this.encrypting) data[k] = v;
      else if (this.cipher.has(k)) data[k] = { [ENC]: this.cipher.get(k) };
      // else: still encrypting (only on a hard quit right after sign-in) — never written in the clear
    }
    return JSON.stringify({ format: FORMAT, data } satisfies FileShape);
  }

  /** Writes pending changes now. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return this.writing;
    this.dirty = false;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await Promise.all(this.sealing.values());
        await this.writeAtomic(this.serialize());
      })
      .catch((err: unknown) => {
        this.dirty = true; // try again with the next change
        throw err;
      });
    return this.writing;
  }

  private async writeAtomic(text: string): Promise<void> {
    const tmp = `${this.file}.tmp`;
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(text, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (existsSync(this.file)) await rename(this.file, `${this.file}.bak`);
    await rename(tmp, this.file);
  }

  /** Synchronous last-chance write for app quit (the event loop may not run again). Same atomic steps. */
  flushSync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.file}.tmp-quit`; // not the async writer's temp file, in case one is mid-way
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, this.serialize());
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.bak`);
    renameSync(tmp, this.file);
  }
}
