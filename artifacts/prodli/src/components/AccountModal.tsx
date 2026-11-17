import { useEffect, useRef, useState } from "react";
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
import {
  accountsEnabled,
  deleteAccount,
  downloadAccountExport,
  getProdliAccount,
  isExtensionBuild,
  listDevices,
  onProdliAccountChange,
  refreshAccount,
  renderGoogleButton,
  signInFromExtension,
  signOutDevice,
  signOutEverywhere,
  signOutHere,
  getAiUsage,
  type AiUsage,
  type Device,
  type ProdliUser,
} from "../lib/prodliAccount";
import { getSyncStatus, onSyncStatusChange, SYNC_MEETINGS_KEY, syncOnce, type SyncStatus } from "../lib/prodliSync";
import { checkout, formatBytes, formatPrice, getBilling, openPortal, type Billing, type Interval } from "../lib/billing";

function PlanBox({ user }: { user: ProdliUser }) {
  const [billing, setBilling] = useState<Billing | null | undefined>(undefined);
  const [period, setPeriod] = useState<Interval>("yearly");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const waiting = useRef<AbortController | null>(null);

  useEffect(() => {
    getBilling().then(
      (b) => {
        setBilling(b);
        if (b.onSale && !b.onSale.yearly) setPeriod("monthly");
      },
      () => setBilling(null),
    );
  }, [user.plan]);
  useEffect(() => () => waiting.current?.abort(), []);

  const buy = async (which: Interval) => {
    setBusy(true);
    setNote(null);
    waiting.current?.abort();
    const ctrl = new AbortController();
    waiting.current = ctrl;
    try {
      const pending = checkout(which, ctrl.signal);
      setNote({ tone: "ok", text: "Checkout opened in a new tab. Pro turns on here as soon as the payment goes through." });
      const r = await pending;
      if (ctrl.signal.aborted) return;
      setBilling(await getBilling());
      setNote(r === "pro" ? { tone: "ok", text: "🎉 You're on ProdLi Pro. Thank you!" } : { tone: "ok", text: "Finished paying? Pro turns on within a minute — reopen this window to check." });
    } catch (err) {
      setNote({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  };

  if (!billing) return null; // loading, or an older server without billing
  const pro = billing.plan === "pro";
  const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleDateString([], { dateStyle: "medium" }) : "");
  const priceText = (i: Interval) => {
    const p = billing.prices[i];
    return p ? formatPrice(p) : "";
  };
  const row = (labelText: string, free: string, proValue: string) => (
    <tr>
      <td style={{ padding: "3px 0", opacity: 0.85 }}>{labelText}</td>
      <td style={{ padding: "3px 8px", textAlign: "right", fontWeight: 700 }}>{free}</td>
      <td style={{ padding: "3px 0", textAlign: "right", fontWeight: 900 }}>{proValue}</td>
    </tr>
  );
  const L = billing.limits;
  const both = !!billing.onSale?.monthly && !!billing.onSale?.yearly;

  return (
    <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 14, display: "grid", gap: 10 }} data-testid="plan-box">
      <div style={{ fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{pro ? "⭐ ProdLi Pro" : "Your plan: Free"}</div>
      {pro ? (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {billing.subscription?.endsAt
              ? `Pro until ${fmtDate(billing.subscription.endsAt)} (cancelled — you won't be charged again).`
              : billing.subscription?.status === "past_due"
                ? "Your last payment didn't go through. Update your card to keep Pro."
                : billing.subscription?.renewsAt
                  ? `Renews ${fmtDate(billing.subscription.renewsAt)}${billing.subscription.interval ? ` (${billing.subscription.interval === "year" ? "yearly" : "monthly"})` : ""}.`
                  : "Thanks for supporting ProdLi!"}
            <br />
            {L.pro.summaries} meeting summaries, {L.pro.briefs} briefs & reviews, {L.pro.asks} Ask ProdLi questions{L.pro.writes ? `, ${L.pro.writes} writing-help uses` : ""} a month, {formatBytes(L.pro.storageBytes)} of sync.
          </div>
          {billing.canManage && (
            <div>
              <button style={btn(false, busy)} disabled={busy} onClick={() => void openPortal().catch((e: Error) => setNote({ tone: "error", text: e.message }))}>
                Manage subscription
              </button>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>Change plan or card, download invoices, or cancel — on Dodo Payments' secure page.</div>
            </div>
          )}
        </>
      ) : (
        <>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={{ textAlign: "left", fontWeight: 800 }}>Per month</th>
                <th style={{ textAlign: "right", fontWeight: 800, padding: "0 8px" }}>Free</th>
                <th style={{ textAlign: "right", fontWeight: 900 }}>Pro</th>
              </tr>
            </thead>
            <tbody>
              {row("AI meeting summaries", String(L.free.summaries), String(L.pro.summaries))}
              {row("AI daily briefs & reviews", String(L.free.briefs), String(L.pro.briefs))}
              {row("Ask ProdLi questions", String(L.free.asks), String(L.pro.asks))}
              {L.free.writes !== undefined && L.pro.writes !== undefined && row("Writing help (✨ Improve)", String(L.free.writes), String(L.pro.writes))}
              {row("Synced storage", formatBytes(L.free.storageBytes), formatBytes(L.pro.storageBytes))}
            </tbody>
          </table>
          {billing.onSale ? (
            <>
              {both && (
                <div role="radiogroup" aria-label="Billing period" style={{ display: "flex", gap: 6 }}>
                  {(["monthly", "yearly"] as const).map((i) => (
                    <button key={i} role="radio" aria-checked={period === i} onClick={() => setPeriod(i)} style={{ ...btn(period === i), flex: 1, textTransform: "none", fontSize: 13 }}>
                      {i === "monthly" ? "Monthly" : "Yearly"}
                      {priceText(i) ? ` · ${priceText(i)}` : ""}
                      {i === "yearly" && <span style={{ display: "block", fontSize: 10, fontWeight: 700 }}>best value</span>}
                    </button>
                  ))}
                </div>
              )}
              <button style={{ ...btn(true, busy), fontSize: 14, padding: "10px 16px" }} disabled={busy} onClick={() => void buy(period)} data-testid="upgrade">
                {busy ? "Waiting for payment…" : `⭐ Upgrade to Pro${priceText(period) ? ` — ${priceText(period)}/${period === "monthly" ? "month" : "year"}` : ""}`}
              </button>
              <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.5 }}>
                Prices in US dollars; checkout shows your local price and any tax. Payments by Dodo Payments, our reseller (merchant of record): it handles tax and invoices. Cancel any time; Pro stays on until the end of the period you paid for.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.8 }}>ProdLi Pro is coming soon. Everything above stays free.</div>
          )}
        </>
      )}
      {note && (
        <div role="status" style={{ border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: note.tone === "ok" ? "#D7F5D7" : "#FFCDD2", color: "#000" }}>
          {note.text}
        </div>
      )}
    </div>
  );
}

type Profile = Pick<GoogleAccount, "name" | "email" | "picture">;

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

export function Avatar({ account, size = 28 }: { account: Profile; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.name || account.email || "?").trim()[0]?.toUpperCase() ?? "?";
  if (account.picture && !failed) {
    return <img src={account.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ borderRadius: "50%", border: "2px solid #FFD700", display: "block" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "#FFD700", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: size * 0.45 }}>{initial}</span>
  );
}

/** Sidebar / top-bar account button: shows the avatar (and name) when signed in. */
export function AccountButton({ onClick, className = "side-btn" }: { onClick: () => void; className?: string }) {
  const [account, setAccount] = useState<Profile | null>(null);
  useEffect(() => {
    if (accountsEnabled()) {
      void getProdliAccount().then(setAccount);
      return onProdliAccountChange(setAccount);
    }
    void getAccount().then(setAccount);
    return onStorageChange<GoogleAccount>(ACCOUNT_KEY, (v) => setAccount(v ?? null));
  }, []);
  return (
    <button
      onClick={onClick}
      className={className}
      title={account ? `Signed in as ${account.email}` : accountsEnabled() ? "Sign in to your ProdLi account" : "Sign in with Google to back up to Drive"}
      aria-label={account ? `Account: ${account.email}` : "Sign in"}
    >
      <span className="side-icon">{account ? <Avatar account={account} size={24} /> : "👤"}</span>
      <span className="side-label">{account ? account.name || account.email : "Sign in"}</span>
    </button>
  );
}

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(ms).toLocaleDateString([], { dateStyle: "medium" });
};

const mb = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round((n / 1024 ** 3) * 10) / 10} GB`;

/** Sync status, "Sync now" and what this device uploads. */
function SyncBox({ ext }: { ext: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [meetings, setMeetings] = useState(true);
  const [running, setRunning] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    void getSyncStatus().then(setStatus);
    void storageGet<boolean>(SYNC_MEETINGS_KEY, true).then(setMeetings);
    const off = onSyncStatusChange(setStatus);
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keep "x min ago" fresh
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const s = status;
  const line =
    !s || (s.state === "idle" && !s.lastSyncAt) ? "Getting ready to sync…"
    : s.state === "syncing" || running ? "Syncing…"
    : s.state === "offline" ? "Offline — your changes are saved here and will sync when you’re back online."
    : s.state === "error" ? `Sync problem: ${s.error ?? "unknown error"}`
    : `Synced ${ago(s.lastSyncAt!)}`;

  return (
    <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 14, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sync</div>
      <div role="status" aria-live="polite" data-testid="sync-status" style={{ fontSize: 13, lineHeight: 1.5, color: s?.state === "error" ? "#E53935" : undefined }}>
        <strong>{line}</strong>
        <br />
        <span style={{ opacity: 0.75 }}>
          Notes, to-dos, habits, meetings (text only), Pomodoro and Time Tracker history stay the same on every device signed in to this account. Settings stay per device.
        </span>
        {s?.usage && (
          <>
            <br />
            <span style={{ opacity: 0.75 }}>Using {mb(s.usage.bytes)} of {mb(s.usage.quota)}.</span>
          </>
        )}
        {!!s?.tooLarge && (
          <>
            <br />
            <span style={{ color: "#E53935" }}>{s.tooLarge} item{s.tooLarge > 1 ? "s are" : " is"} too large to sync (over about 1.4 MB) and stay on this device only.</span>
          </>
        )}
      </div>
      {ext && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={meetings}
            style={{ marginTop: 3 }}
            onChange={async () => {
              setMeetings(!meetings);
              await storageSet(SYNC_MEETINGS_KEY, !meetings);
            }}
          />
          <span>
            Sync meetings recorded on this computer
            <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>Transcripts include what other people said. Audio is never uploaded.</span>
          </span>
        </label>
      )}
      <div>
        <button
          style={btn(true, running)}
          disabled={running}
          onClick={() => {
            setRunning(true);
            void syncOnce({ forceTracking: true })
              .catch(() => {})
              .finally(() => setRunning(false));
          }}
        >
          {running ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
}

export type AccountView = "account" | "devices";

/** Shared state for the ProdLi account sections. */
function useProdliUser() {
  const [user, setUser] = useState<ProdliUser | null | undefined>(undefined);
  useEffect(() => {
    void getProdliAccount().then((cached) => {
      setUser(cached);
      void refreshAccount().then(setUser);
    });
    return onProdliAccountChange(setUser);
  }, []);
  return [user, setUser] as const;
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
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
  const status = message && (
    <div role="status" style={{ border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: message.tone === "ok" ? "#D7F5D7" : "#FFCDD2", color: "#000" }}>
      {message.text}
    </div>
  );
  return { busy, act, setMessage, status };
}

export const sectionTitle: React.CSSProperties = { fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" };
export const box: React.CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", padding: 14, display: "grid", gap: 10 };

/** Shown in sections that need an account, when signed out. */
function SignInFirst({ what, onSignIn }: { what: string; onSignIn: () => void }) {
  return (
    <div style={box}>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>{what}</div>
      <div>
        <button style={btn(true)} onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}

/** Settings › Account: profile, sign in / out, delete account. */
function ProdliAccountSection() {
  const ext = isExtensionBuild();
  const [user, setUser] = useProdliUser();
  const { busy, act, setMessage, status } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const googleBtn = useRef<HTMLDivElement>(null);
  const [buttonError, setButtonError] = useState<string | null>(null);

  useEffect(() => {
    if (ext || user !== null || !googleBtn.current) return;
    // Google's script rewrites the element it's given, so give it one React
    // doesn't manage (React would crash removing nodes Google replaced).
    const host = document.createElement("div");
    googleBtn.current.appendChild(host);
    let cancelled = false;
    renderGoogleButton(
      host,
      (u) => {
        setUser(u);
        setMessage({ tone: "ok", text: `Signed in as ${u.email}.` });
      },
      (e) => setMessage({ tone: "error", text: e.message }),
    ).catch((e: Error) => !cancelled && setButtonError(e.message));
    return () => {
      cancelled = true;
      host.remove();
    };
  }, [ext, user, setUser, setMessage]);

  if (user === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>;

  if (!user) {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          Sign in to your <strong>ProdLi account</strong> to keep your notes, to-dos, habits, meetings and history the same on every computer — in the extension and at app.prodli.com.
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, listStyle: "disc" }}>
            <li>What’s already on this device is added to your account; nothing is overwritten.</li>
            <li>Free. ProdLi keeps working without an account, and offline.</li>
            <li>Meeting audio is never uploaded.</li>
            <li>You can download or delete your account any time.</li>
          </ul>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
            By signing in you agree to the <a href="https://prodli.com/terms" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Terms</a> and{" "}
            <a href="https://prodli.com/privacy" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Privacy Policy</a>, and confirm you’re 18 or older.
          </div>
        </div>
        {ext ? (
          <button
            onClick={() => void act("signin", async () => {
              const u = await signInFromExtension(true);
              setUser(u);
              setMessage({ tone: "ok", text: `Signed in as ${u.email}. Syncing your data…` });
            })}
            disabled={!!busy}
            style={{ ...btn(false, !!busy), display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#fff", color: "#1f1f1f", textTransform: "none", fontSize: 14, padding: "10px 16px" }}
          >
            <GoogleG /> {busy === "signin" ? "Signing in…" : "Sign in with Google"}
          </button>
        ) : (
          <>
            <div ref={googleBtn} data-testid="google-signin" style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />
            {buttonError && <div style={{ fontSize: 12, color: "#E53935", textAlign: "center" }}>{buttonError}</div>}
          </>
        )}
        {status}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...box, gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12 }}>
        <Avatar account={user} size={48} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{user.name || user.email}</div>
          <div style={{ fontSize: 13, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
        </div>
        <span style={{ border: "var(--nb-border)", padding: "2px 8px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", background: user.plan === "pro" ? "#FFD700" : "transparent", color: user.plan === "pro" ? "#000" : undefined }}>{user.plan === "pro" ? "Pro" : "Free"}</span>
      </div>

      <div style={{ ...box, gridTemplateColumns: "1fr auto", alignItems: "center" }}>
        <div>
          <div style={sectionTitle}>Sign out</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Signs out of this {ext ? "extension" : "browser"}. Everything stays on this device.</div>
        </div>
        <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => void act("signout", async () => {
          await signOutHere();
          if (ext && (await getAccount())) await signOut();
          setUser(null);
          setMessage({ tone: "ok", text: "Signed out." });
        })}>
          Sign out
        </button>
      </div>

      <div style={{ ...box, borderColor: "#E53935" }}>
        <div style={{ ...sectionTitle, color: "#C62828" }}>Danger zone</div>
        {!confirmDelete ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.8, flex: 1, minWidth: 200 }}>Delete your ProdLi account and everything synced to ProdLi’s servers{user.plan === "pro" ? " (your Pro subscription is cancelled too)" : ""}. Data saved on this device stays here.</span>
            <button style={{ ...btn(false, !!busy), color: "#C62828" }} disabled={!!busy} onClick={() => setConfirmDelete(true)}>
              Delete account…
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
            <strong>Delete your ProdLi account permanently?</strong>
            <span>This removes your account and everything synced to ProdLi’s servers, and signs out every device. Data saved on this device stays here. This can’t be undone.</span>
            <label style={{ display: "grid", gap: 4 }}>
              Type <strong>{user.email}</strong> to confirm:
              <input value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} aria-label="Type your email to confirm" style={{ border: "var(--nb-border)", padding: "6px 8px", fontFamily: "inherit", background: "hsl(var(--background))", color: "inherit" }} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...btn(false, !!busy || typedEmail.trim().toLowerCase() !== user.email.toLowerCase()), background: "#C62828", color: "#fff" }}
                disabled={!!busy || typedEmail.trim().toLowerCase() !== user.email.toLowerCase()}
                onClick={() => void act("delete", async () => {
                  await deleteAccount(typedEmail);
                  if (ext && (await getAccount())) await signOut();
                  setConfirmDelete(false);
                  setUser(null);
                  setMessage({ tone: "ok", text: "Your ProdLi account was deleted." });
                })}
              >
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
              <button style={btn()} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {status}
    </div>
  );
}

/** Settings › Sync & devices. */
function ProdliDevicesSection({ onSignIn }: { onSignIn: () => void }) {
  const ext = isExtensionBuild();
  const [user, setUser] = useProdliUser();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const { busy, act, setMessage, status } = useAction();

  useEffect(() => {
    if (!user) return setDevices(null);
    listDevices().then(setDevices, () => setDevices(null));
  }, [user]);

  if (user === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>;
  if (!user)
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <SignInFirst what="Sign in to keep your notes, to-dos, habits, meetings and history the same on every computer — in the extension and at app.prodli.com." onSignIn={onSignIn} />
        {status}
      </div>
    );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <SyncBox ext={ext} />
      <div style={box}>
        <div style={sectionTitle}>Signed-in devices</div>
        {devices === null ? (
          <span style={{ fontSize: 13, opacity: 0.7 }}>Loading…</span>
        ) : (
          devices.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>
                <strong>{d.client === "extension" ? "Extension" : "Web"}</strong> · {d.device || "Unknown device"} · {ago(d.lastUsedAt)}
                {d.current && <em style={{ marginLeft: 6, opacity: 0.7 }}>(this one)</em>}
              </span>
              {!d.current && (
                <button
                  style={btn(false, !!busy)}
                  disabled={!!busy}
                  onClick={() => void act(`device-${d.id}`, async () => {
                    await signOutDevice(d.id);
                    setDevices((list) => (list ?? []).filter((x) => x.id !== d.id));
                  })}
                >
                  Sign out
                </button>
              )}
            </div>
          ))
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: "1px dashed hsl(var(--border))", paddingTop: 10 }}>
          <span style={{ fontSize: 12, opacity: 0.75 }}>Lost a device? Sign out of all of them at once.</span>
          <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => void act("everywhere", async () => {
            await signOutEverywhere();
            if (ext && (await getAccount())) await signOut();
            setUser(null);
            setMessage({ tone: "ok", text: "Signed out on every device." });
          })}>
            Sign out everywhere
          </button>
        </div>
      </div>
      {status}
    </div>
  );
}

/** One "used / limit" bar. */
function UsageBar({ label, used, limit, format = String }: { label: string; used: number; limit: number; format?: (n: number) => string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 800 }}>
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div style={{ height: 6, background: "hsl(var(--muted))", marginTop: 4 }} role="presentation">
        <div style={{ height: "100%", width: `${pct}%`, background: pct >= 90 ? "#C62828" : "#00BCD4" }} />
      </div>
    </div>
  );
}

/** Settings › Plan & usage. */
function PlanSection({ onSignIn }: { onSignIn: () => void }) {
  const [user] = useProdliUser();
  const [ai, setAi] = useState<AiUsage | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  useEffect(() => {
    if (!user) return;
    getAiUsage().then(setAi, () => setAi(null));
    void getSyncStatus().then(setSync);
  }, [user]);
  if (user === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>;
  if (!user) return <SignInFirst what="Sign in to see your plan, this month's AI allowance and ProdLi Pro." onSignIn={onSignIn} />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PlanBox user={user} />
      {(ai || sync?.usage) && (
        <div style={box} data-testid="usage">
          <div style={sectionTitle}>This month</div>
          {ai?.available && <UsageBar label="AI meeting summaries" used={ai.used} limit={ai.limit} />}
          {ai?.briefs && <UsageBar label="AI daily briefs & weekly reviews" used={ai.briefs.used} limit={ai.briefs.limit} />}
          {ai?.asks && <UsageBar label="Ask ProdLi questions" used={ai.asks.used} limit={ai.asks.limit} />}
          {ai?.writes && <UsageBar label="Writing help (✨ Improve)" used={ai.writes.used} limit={ai.writes.limit} />}
          {sync?.usage && <UsageBar label="Synced storage" used={sync.usage.bytes} limit={sync.usage.quota} format={mb} />}
          <div style={{ fontSize: 11, opacity: 0.7 }}>AI allowances reset on the 1st of each month.</div>
        </div>
      )}
    </div>
  );
}

/** Settings › Backup & data: the account's server copy (ProdLi accounts only). */
export function AccountDataSection() {
  const [user] = useProdliUser();
  const { busy, act, setMessage, status } = useAction();
  if (!accountsEnabled() || !user) return null;
  return (
    <div style={box}>
      <div style={sectionTitle}>Your account's data</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>Everything synced to your ProdLi account, as one file (JSON): notes, to-dos, habits, meetings (text), history and settings of your account.</div>
      <div>
        <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => void act("export", async () => {
          await downloadAccountExport();
          setMessage({ tone: "ok", text: "Downloaded your account data." });
        })}>
          Download my data
        </button>
      </div>
      {status}
    </div>
  );
}

/** Settings › Account (or Sync & devices): the right panel for this build. */
export function AccountPanel({ view, onSignIn }: { view: AccountView; onSignIn: () => void }) {
  if (accountsEnabled()) return view === "account" ? <ProdliAccountSection /> : <ProdliDevicesSection onSignIn={onSignIn} />;
  return <DriveAccountPanel />;
}

export function PlanPanel({ onSignIn }: { onSignIn: () => void }) {
  return <PlanSection onSignIn={onSignIn} />;
}

/** Builds without a ProdLi server: Google Drive sync. */
function DriveAccountPanel() {
  const withServer = false;
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
    return () => offs.forEach((off) => off());
  }, []);

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
        <div style={{ display: "grid", gap: 16 }}>
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
                  <li>No ProdLi servers, no cost.</li>
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
              {!withServer && (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Avatar account={account} size={48} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>{account.name}</div>
                    <div style={{ fontSize: 13, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis" }}>{account.email}</div>
                  </div>
                </div>
              )}

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

              {!withServer && (
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
              )}
            </>
          )}

          {message && (
            <div role="status" style={{ border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: message.tone === "ok" ? "#D7F5D7" : "#FFCDD2", color: "#000" }}>
              {message.text}
            </div>
          )}
        </div>
  );
}
