// The avatar button (sidebar, phone top bar) and its menu: who you are, your
// plan, and quick ways into Settings — instead of opening a long panel.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { getAccount, signOut as signOutGoogle, ACCOUNT_KEY, type GoogleAccount } from "../lib/google";
import { accountsEnabled, getProdliAccount, isExtensionBuild, onProdliAccountChange, signOutHere } from "../lib/prodliAccount";
import { onStorageChange } from "../lib/storage";
import { Avatar } from "./AccountModal";
import { openSettings, type SettingsTab } from "./Settings";

type Profile = { email: string; name: string; picture: string | null; plan?: string };

function useProfile(): Profile | null {
  const [account, setAccount] = useState<Profile | null>(null);
  useEffect(() => {
    if (accountsEnabled()) {
      void getProdliAccount().then(setAccount);
      return onProdliAccountChange(setAccount);
    }
    void getAccount().then(setAccount);
    return onStorageChange<GoogleAccount>(ACCOUNT_KEY, (v) => setAccount(v ?? null));
  }, []);
  return account;
}

const item: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  border: "none",
  background: "transparent",
  color: "inherit",
  padding: "8px 12px",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
};

export function ProfileMenu({ variant, isDark, onToggleTheme, onSignedOut }: { variant: "sidebar" | "topbar"; isDark: boolean; onToggleTheme: () => void; onSignedOut?: (msg: string) => void }) {
  const account = useProfile();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos(variant === "sidebar" ? { left: Math.max(8, r.left + 8), bottom: Math.max(8, window.innerHeight - r.top + 6) } : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 });
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem], [role=menuitemcheckbox]")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (tab: SettingsTab) => {
    setOpen(false);
    openSettings(tab);
  };

  const signOut = async () => {
    setOpen(false);
    if (accountsEnabled()) {
      await signOutHere().catch(() => {});
      if (isExtensionBuild() && (await getAccount())) await signOutGoogle();
    } else {
      await signOutGoogle();
    }
    onSignedOut?.("Signed out. Everything stays on this device.");
  };

  // Arrow keys move between items (menu pattern).
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem], [role=menuitemcheckbox]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const server = accountsEnabled();
  const pro = account?.plan === "pro";
  const label = account ? `Account: ${account.email}` : "Sign in";

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={variant === "sidebar" ? "side-btn" : "mobile-icon mobile-account"}
        title={account ? `Signed in as ${account.email}` : "Account & settings"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="side-icon">{account ? <Avatar account={account} size={24} /> : "👤"}</span>
        {variant === "sidebar" && <span className="side-label">{account ? account.name || account.email : "Sign in"}</span>}
        {variant === "sidebar" && <span className="side-label" aria-hidden style={{ flex: "none", opacity: 0.6 }}>⚙</span>}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Account and settings" className="profile-menu" style={pos} onKeyDown={onMenuKey}>
          <div className="profile-menu-head">
            {account ? (
              <>
                <Avatar account={account} size={36} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.name || account.email}</div>
                  <div style={{ fontSize: 12, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.email}</div>
                </div>
                {server && <span className={`profile-plan${pro ? " is-pro" : ""}`}>{pro ? "Pro" : "Free"}</span>}
              </>
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                <strong>Not signed in.</strong>
                <br />
                <span style={{ opacity: 0.75 }}>{server ? "Sign in to sync between devices." : "Sign in to sync through Google Drive."}</span>
              </div>
            )}
          </div>
          {!account && (
            <button role="menuitem" style={{ ...item, background: "#FFD700", color: "#000" }} onClick={() => go("account")}>
              <span aria-hidden>👤</span> Sign in
            </button>
          )}
          <button role="menuitem" style={item} onClick={() => go("account")}>
            <span aria-hidden>⚙️</span> Settings
          </button>
          {server && account && !pro && (
            <button role="menuitem" style={item} onClick={() => go("plan")}>
              <span aria-hidden>⭐</span> Upgrade to Pro
            </button>
          )}
          {server && account && (
            <button role="menuitem" style={item} onClick={() => go("devices")}>
              <span aria-hidden>🔄</span> Sync & devices
            </button>
          )}
          <button role="menuitem" style={item} onClick={() => go("data")}>
            <span aria-hidden>💾</span> Backup & data
          </button>
          <button role="menuitemcheckbox" aria-checked={isDark} style={item} onClick={onToggleTheme}>
            <span aria-hidden>{isDark ? "☀️" : "🌙"}</span> {isDark ? "Light mode" : "Dark mode"}
          </button>
          <button role="menuitem" style={item} onClick={() => go("help")}>
            <span aria-hidden>❓</span> Help & shortcuts
          </button>
          {account && (
            <>
              <div role="separator" style={{ borderTop: "1px solid hsl(var(--border))", margin: "4px 0" }} />
              <button role="menuitem" style={item} onClick={() => void signOut()}>
                <span aria-hidden>↩</span> Sign out
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
