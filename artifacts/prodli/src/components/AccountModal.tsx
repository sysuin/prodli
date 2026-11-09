import { useEffect, useState } from "react";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import {
  ACCOUNT_KEY,
  AUTO_BACKUP_KEY,
  syncWithDrive,
  getAccount,
  googleConfigured,
  LAST_BACKUP_KEY,
  latestDriveBackup,
  restoreFromDrive,
  signIn,
  signOut,
  type BackupInfo,
  type GoogleAccount,
} from "../lib/google";

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "8px 14px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Avatar({ account, size = 28 }: { account: GoogleAccount; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.name || account.email || "?").trim()[0]?.toUpperCase() ?? "?";
  if (account.picture && !failed) {
    return <img src={account.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ borderRadius: "50%", border: "2px solid #FFD700", display: "block" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "#FFD700", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: size * 0.45 }}>{initial}</span>
  );
}

/** Top-bar account button: shows the avatar when signed in. */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  useEffect(() => {
    void getAccount().then(setAccount);
    return onStorageChange<GoogleAccount>(ACCOUNT_KEY, (v) => setAccount(v ?? null));
  }, []);
  return (
    <button
      onClick={onClick}
      title={account ? `Signed in as ${account.email}` : "Sign in with Google to back up to Drive"}
      aria-label={account ? `Account: ${account.email}` : "Sign in"}
      style={{ border: "none", borderLeft: "2px solid #222", background: "transparent", color: "#888", cursor: "pointer", padding: "0 12px", display: "flex", alignItems: "center", gap: 6, fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "inherit", flexShrink: 0 }}
    >
      {account ? <Avatar account={account} size={26} /> : <span>👤 Sign in</span>}
    </button>
  );
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const configured = googleConfigured();
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<BackupInfo | null>(null);
  const [driveCopy, setDriveCopy] = useState<{ modifiedTime: string | null; bytes: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    void Promise.all([getAccount(), storageGet<boolean>(AUTO_BACKUP_KEY, true), storageGet<BackupInfo | null>(LAST_BACKUP_KEY, null)]).then(([a, au, l]) => {
      setAccount(a);
      setAuto(au);
      setLast(l);
    });
    const offs = [
      onStorageChange<GoogleAccount>(ACCOUNT_KEY, (v) => setAccount(v ?? null)),
      onStorageChange<BackupInfo>(LAST_BACKUP_KEY, (v) => setLast(v ?? null)),
    ];
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!account) return;
    setDriveCopy(undefined);
    latestDriveBackup().then(setDriveCopy, () => setDriveCopy(null));
  }, [account, last]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };

  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return (
    <div role="dialog" aria-modal="true" aria-label="Account" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ background: "#000", color: "#FFD700", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>Account & Google Drive sync</span>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "#FFD700", fontSize: 20, cursor: "pointer", fontWeight: 900 }}>×</button>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 16 }}>
          {!configured ? (
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <strong>Google sign-in isn’t set up in this copy of ProdLi yet.</strong>
              <p style={{ margin: "8px 0 0" }}>Everything still works without an account — your data stays on this device. (Developers: add a Google OAuth client ID as described in <code>docs/GOOGLE-SIGN-IN.md</code>.)</p>
            </div>
          ) : !account ? (
            <>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                Sign in to sync your notes, to-dos, habits, Pomodoro history and meeting notes across your computers through <strong>your own Google Drive</strong> — edits from every computer are merged, nothing gets overwritten.
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, listStyle: "disc" }}>
                  <li>Your data goes to a private ProdLi folder in your Drive that only ProdLi can see — not your other files.</li>
                  <li>No ProdLi servers, no cost. Your Claude API key is never backed up.</li>
                  <li>ProdLi keeps working without an account.</li>
                </ul>
              </div>
              <button
                onClick={() => void act("signin", async () => {
                  const a = await signIn();
                  setAccount(a);
                  setMessage({ tone: "ok", text: `Signed in as ${a.email}. Syncing…` });
                  const r = await syncWithDrive();
                  setLast(r);
                  setMessage({ tone: "ok", text: `Signed in as ${a.email} and synced${r.changes ? ` — ${r.changes} update(s) from your other computers` : ""}.` });
                })}
                disabled={!!busy}
                style={{ ...btn(false, !!busy), display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#fff", color: "#1f1f1f", textTransform: "none", fontSize: 14, padding: "10px 16px" }}
              >
                <GoogleG /> {busy === "signin" ? "Signing in…" : "Sign in with Google"}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Avatar account={account} size={48} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{account.name}</div>
                  <div style={{ fontSize: 13, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis" }}>{account.email}</div>
                </div>
              </div>

              <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 14, display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Google Drive sync</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  Last synced from this computer: <strong>{fmt(last?.at)}</strong>
                  {last ? ` (${kb(last.bytes)}${last.auto ? ", automatic" : ""})` : ""}
                  <br />
                  Latest copy in Drive: <strong>{driveCopy === undefined ? "checking…" : driveCopy ? fmt(driveCopy.modifiedTime) : "none yet"}</strong>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={async () => {
                      setAuto(!auto);
                      await storageSet(AUTO_BACKUP_KEY, !auto);
                    }}
                  />
                  Sync automatically (about every hour)
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    disabled={!!busy}
                    style={btn(true, !!busy)}
                    onClick={() => void act("backup", async () => {
                      const info = await syncWithDrive();
                      setLast(info);
                      setMessage({ tone: "ok", text: `Synced with Google Drive (${kb(info.bytes)})${info.changes ? ` — ${info.changes} update(s) from other computers` : ""}.` });
                    })}
                  >
                    {busy === "backup" ? "Syncing…" : "Sync now"}
                  </button>
                  <button disabled={!!busy || !driveCopy} style={btn(false, !!busy || !driveCopy)} onClick={() => setConfirmRestore(true)}>
                    Replace with Drive copy…
                  </button>
                </div>
                {confirmRestore && (
                  <div style={{ border: "2px solid #E53935", padding: 10, fontSize: 13, display: "grid", gap: 8 }}>
                    <strong>Replace everything on this computer with the Drive copy from {fmt(driveCopy?.modifiedTime)}?</strong>
                    <span>Normally “Sync now” is what you want — it merges. Replacing overwrites notes, to-dos, habits, Pomodoro data, time tracking and meetings here. This can’t be undone.</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        style={{ ...btn(false, !!busy), background: "#E53935", color: "#fff" }}
                        disabled={!!busy}
                        onClick={() => void act("restore", async () => {
                          const r = await restoreFromDrive();
                          setConfirmRestore(false);
                          if (!r.ok) throw new Error(r.error ?? "Restore failed.");
                          setMessage({ tone: "ok", text: "Restored from Google Drive. Reloading…" });
                          setTimeout(() => window.location.reload(), 900);
                        })}
                      >
                        {busy === "restore" ? "Restoring…" : "Yes, restore"}
                      </button>
                      <button style={btn()} onClick={() => setConfirmRestore(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Signing out keeps all data on this device.</span>
                <button
                  disabled={!!busy}
                  style={btn(false, !!busy)}
                  onClick={() => void act("signout", async () => {
                    await signOut();
                    setAccount(null);
                    setMessage({ tone: "ok", text: "Signed out." });
                  })}
                >
                  Sign out
                </button>
              </div>
            </>
          )}

          {message && (
            <div role="status" style={{ border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: message.tone === "ok" ? "#D7F5D7" : "#FFCDD2", color: "#000" }}>
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
