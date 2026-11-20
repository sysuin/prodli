// Pro-only features: a "PRO" badge, and a one-line note under the feature:
// free during early access (before Pro is on sale), "Upgrade" when it's needed,
// nothing for Pro users. Server: billing.ts proFeatureAllowed.

import { useEffect, useState } from "react";
import { getProAccess, openUpgrade, type ProAccess } from "../lib/billing";
import { accountsEnabled, onProdliAccountChange } from "../lib/prodliAccount";

export function useProAccess(): ProAccess | null {
  const [access, setAccess] = useState<ProAccess | null>(null);
  useEffect(() => {
    if (!accountsEnabled()) return;
    const load = () => void getProAccess().then(setAccess, () => setAccess(null));
    load();
    return onProdliAccountChange(load);
  }, []);
  return access;
}

export function ProBadge() {
  return (
    <span title="ProdLi Pro feature" style={{ background: "#FFD700", color: "#000", border: "1px solid #000", fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", padding: "0 4px", marginLeft: 6, verticalAlign: "middle" }}>
      PRO
    </span>
  );
}

/** What the user needs to know about a Pro-only feature, or nothing. */
export function ProNote({ access, what }: { access: ProAccess | null; what: string }) {
  if (!access || access.pro) return null;
  if (!access.signedIn) return <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{what} need a ProdLi account (👤, free to start).</div>;
  if (access.earlyAccess) return <div data-testid="pro-early-access" style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>A ProdLi Pro feature, free for everyone while Pro is launching.</div>;
  return (
    <div data-testid="pro-upgrade" style={{ fontSize: 11, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span>{what} are part of ProdLi Pro.</span>
      <button onClick={openUpgrade} style={{ border: "1px solid #000", background: "#FFD700", color: "#000", fontWeight: 800, fontSize: 11, padding: "1px 8px", cursor: "pointer", fontFamily: "inherit" }}>
        Upgrade
      </button>
    </div>
  );
}
