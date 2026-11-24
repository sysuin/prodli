// Settings › Plan & usage: Free, Pro and Pro Plus side by side, a Monthly /
// Yearly switch, and one button per plan. Buying takes as few steps as
// possible: one click opens Dodo's one-page checkout (card and postcode), and
// it comes straight back to ProdLi, which turns the plan on by itself. Signed
// out, the button signs in first and then carries on to the checkout. Already
// paying, the buttons switch plans (higher plans now, lower ones at renewal),
// so nobody ends up with two subscriptions.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { changePlan, checkout, formatBytes, formatPrice, getBilling, getPlans, openPortal, PENDING_UPGRADE_KEY, pendingUpgradeFresh, PLAN_NAMES, tierOf, trialDaysLeft, yearlySaving, type Billing, type Interval, type PaidPlan, type PendingUpgrade, type PlanLimits, type PlanOffer, type PublicPlans, type Tier } from "../lib/billing";
import { storageGet, storageRemove, storageSet } from "../lib/storage";
import type { ProdliUser } from "../lib/prodliAccount";

const ACCENT = "#FFD700";
const FEATURES = [
  "Your own meeting templates",
  "Talk-time insights",
  "Action items across all meetings",
  "AI meeting prep",
  "Focus trends (30 and 90 days)",
  "Your writing style",
  "Meeting series history",
  "Notes in your language",
  "Prep reminders before meetings",
  "Key moments in summaries",
  "Meeting insights",
  "Meeting coach (AI feedback)",
  "Dictation Command Mode (edit by voice)",
  "Summaries that build on your notes",
  "Decision log",
  "Meeting type rules",
];

const btn = (primary: boolean, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? ACCENT : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "9px 12px",
  fontWeight: 900,
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
  fontFamily: "inherit",
  width: "100%",
});

/** "$4" a month for a yearly price, "$12" for a monthly one. */
function perMonth(offer: PlanOffer | undefined, interval: Interval): string {
  const p = offer?.prices[interval];
  if (!p) return "";
  return formatPrice(interval === "yearly" ? { ...p, amount: Math.round(p.amount / 12) } : p);
}

const limitLines = (L: PlanLimits) => [
  `${L.summaries.toLocaleString()} AI meeting summaries`,
  L.transcribeMinutes !== undefined ? `${(L.transcribeMinutes / 60).toLocaleString(undefined, { maximumFractionDigits: 0 })} h of audio transcription` : null,
  `${L.asks.toLocaleString()} Ask ProdLi questions`,
  `${L.briefs.toLocaleString()} daily briefs & reviews`,
  L.writes !== undefined ? `${L.writes.toLocaleString()} writing-help uses` : null,
  L.dictations !== undefined ? `${L.dictations.toLocaleString()} dictation clean-ups` : null,
  `${formatBytes(L.storageBytes)} synced storage`,
].filter((x): x is string => !!x);

export function PlanPicker({ user, onSignIn }: { user: ProdliUser | null; onSignIn: () => void }) {
  const [billing, setBilling] = useState<Billing | null | undefined>(undefined);
  const [publicPlans, setPublicPlans] = useState<PublicPlans | null | undefined>(undefined);
  const [interval, setIntervalState] = useState<Interval>("yearly");
  const [busy, setBusy] = useState<PaidPlan | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [compare, setCompare] = useState(false);
  const waiting = useRef<AbortController | null>(null);

  useEffect(() => {
    if (user) {
      getBilling().then(
        (b) => {
          setBilling(b);
          if (b.subscription?.interval === "month") setIntervalState("monthly");
        },
        () => setBilling(null),
      );
    } else {
      setBilling(null);
      getPlans().then(setPublicPlans, () => setPublicPlans(null));
    }
  }, [user, user?.plan, user?.tier]);
  useEffect(() => () => waiting.current?.abort(), []);

  const offers: Partial<Record<PaidPlan, PlanOffer>> = billing ? (billing.plans ?? (billing.onSale ? { pro: { onSale: billing.onSale, prices: billing.prices } } : {})) : (publicPlans?.plans ?? {});
  const limits = billing?.limits ?? publicPlans?.limits;
  const trial = billing?.trial ?? null;
  const sub = billing?.subscription && !trial ? billing.subscription : null;
  const subscribed = !!sub && (sub.status === "active" || sub.status === "past_due");
  const tier: Tier = billing ? (trial ? "free" : tierOf(billing)) : "free";
  const subInterval: Interval | null = sub?.interval === "year" ? "yearly" : sub?.interval === "month" ? "monthly" : null;
  const onSale = Object.keys(offers).length > 0;
  const bothPeriods = Object.values(offers).some((o) => o?.onSale.monthly) && Object.values(offers).some((o) => o?.onSale.yearly);
  const saving = Math.max(yearlySaving(offers.pro) ?? 0, yearlySaving(offers.plus) ?? 0);
  const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString([], { dateStyle: "medium" }) : "");

  const finish = async () => {
    setBilling(await getBilling().catch(() => billing ?? null));
  };

  const choose = async (plan: PaidPlan, i: Interval = interval) => {
    setNote(null);
    if (!user) {
      // Sign in first, then carry straight on to the checkout.
      await storageSet(PENDING_UPGRADE_KEY, { plan, interval: i, at: Date.now() } satisfies PendingUpgrade);
      onSignIn();
      return;
    }
    waiting.current?.abort();
    const ctrl = new AbortController();
    waiting.current = ctrl;
    setBusy(plan);
    try {
      if (subscribed) {
        const r = await changePlan(plan, i, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setNote(
          r === "at_renewal"
            ? { tone: "ok", text: `Done: you move to ${PLAN_NAMES[plan]} at your next renewal${sub?.renewsAt ? ` (${fmtDate(sub.renewsAt)})` : ""}. Nothing is charged now.` }
            : r === "done"
              ? { tone: "ok", text: `🎉 You're on ${PLAN_NAMES[plan]}${i === "yearly" ? " (yearly)" : ""}. The unused part of your old plan was credited.` }
              : { tone: "ok", text: "Switching… it shows here within a minute." },
        );
      } else {
        const pending = checkout(plan, i, ctrl.signal);
        setNote({ tone: "ok", text: `Checkout opened in a new tab. ${PLAN_NAMES[plan]} turns on here as soon as the payment goes through.` });
        const r = await pending;
        if (ctrl.signal.aborted) return;
        setNote(r === "done" ? { tone: "ok", text: `🎉 You're on ProdLi ${PLAN_NAMES[plan]}. Thank you!` } : { tone: "ok", text: `Finished paying? ${PLAN_NAMES[plan]} turns on within a minute — reopen this window to check.` });
      }
      await finish();
    } catch (err) {
      setNote({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      if (!ctrl.signal.aborted) setBusy(null);
    }
  };

  // Picked a plan before signing in: carry on to the checkout once signed in.
  const resumed = useRef(false);
  useEffect(() => {
    if (!user || !billing || resumed.current) return;
    resumed.current = true;
    void storageGet<PendingUpgrade | null>(PENDING_UPGRADE_KEY, null).then((p) => {
      void storageRemove(PENDING_UPGRADE_KEY);
      if (!pendingUpgradeFresh(p) || !offers[p.plan]?.onSale[p.interval]) return;
      if (subscribed && tier === p.plan && subInterval === p.interval) return;
      setIntervalState(p.interval);
      void choose(p.plan, p.interval);
    });
  });

  if (user && billing === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading plans…</div>;
  if (!user && publicPlans === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading plans…</div>;
  if (!limits) return null; // an older server without billing

  /** The button on a paid plan's card. */
  const action = (plan: PaidPlan): { label: string; primary: boolean; disabled: boolean; hint?: string } | null => {
    const offer = offers[plan];
    if (!offer?.onSale[interval]) return null;
    const name = PLAN_NAMES[plan];
    if (!user) return { label: `Sign in & get ${name}`, primary: plan === "pro", disabled: false };
    if (!subscribed) return { label: busy === plan ? "Waiting for payment…" : `Get ${name}`, primary: plan === "pro", disabled: !!busy };
    if (tier === plan && subInterval === interval) return { label: "✓ Your plan", primary: false, disabled: true };
    const up = (plan === "plus" && tier !== "plus") || (plan === tier && interval === "yearly");
    const label = plan === tier ? `Switch to ${interval}` : `Switch to ${name}`;
    return { label: busy === plan ? "Switching…" : label, primary: up, disabled: !!busy, hint: up ? "Starts now; the unused part of your plan is credited." : "Starts at your next renewal; nothing charged now." };
  };

  const card = (plan: Tier) => {
    const L = plan === "free" ? limits.free : plan === "pro" ? limits.pro : limits.plus;
    if (!L) return null;
    const offer = plan === "free" ? undefined : offers[plan];
    if (plan !== "free" && !offer) return null;
    const current = (plan === "free" && tier === "free" && !trial && !!user) || (plan !== "free" && tier === plan && subscribed);
    const a = plan === "free" ? null : action(plan);
    const price = plan === "free" ? formatPrice({ amount: 0, currency: offer?.prices.monthly?.currency ?? offers.pro?.prices.monthly?.currency ?? "USD" }) : perMonth(offer, interval) || perMonth(offer, interval === "yearly" ? "monthly" : "yearly");
    const yearlyTotal = plan !== "free" && interval === "yearly" ? offer?.prices.yearly : null;
    const popular = plan === "pro";
    return (
      <div
        key={plan}
        data-testid={`plan-card-${plan}`}
        style={{ border: popular ? "3px solid #000" : "var(--nb-border)", boxShadow: popular ? `5px 5px 0 ${ACCENT}` : "none", background: "hsl(var(--card))", padding: 12, display: "flex", flexDirection: "column", gap: 8, position: "relative", minWidth: 0 }}
      >
        {popular && <span style={{ position: "absolute", top: -11, left: 10, background: "#000", color: ACCENT, fontSize: 10, fontWeight: 900, padding: "2px 8px", letterSpacing: "0.06em", textTransform: "uppercase" }}>Most popular</span>}
        <div style={{ fontWeight: 900, fontSize: 15 }}>
          {plan === "free" ? "Free" : plan === "pro" ? "⭐ Pro" : "🚀 Pro Plus"}
          {current && <span style={{ marginLeft: 6, fontSize: 10, border: "1px solid currentColor", padding: "0 5px", verticalAlign: "middle" }}>CURRENT</span>}
        </div>
        <div>
          <span style={{ fontSize: 26, fontWeight: 900 }}>{price}</span>
          <span style={{ fontSize: 12, opacity: 0.75 }}> / month</span>
          <div style={{ fontSize: 11, opacity: 0.75, minHeight: 15 }}>{plan === "free" ? "Forever" : yearlyTotal ? `${formatPrice(yearlyTotal)} billed yearly` : "Billed monthly"}</div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, fontSize: 12, flex: 1, alignContent: "start" }}>
          {plan !== "free" && <li style={{ fontWeight: 800 }}>{plan === "plus" ? "Everything in Pro, with bigger limits:" : "All Pro features, plus:"}</li>}
          {limitLines(L).map((t) => (
            <li key={t}>✓ {t}</li>
          ))}
        </ul>
        {a && (
          <>
            <button data-testid={`choose-${plan}`} style={btn(a.primary, a.disabled)} disabled={a.disabled} onClick={() => void choose(plan as PaidPlan)}>
              {a.label}
            </button>
            {a.hint && !a.disabled && <div style={{ fontSize: 10, opacity: 0.75 }}>{a.hint}</div>}
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ border: "var(--nb-border)", background: "hsl(var(--background))", padding: 14, display: "grid", gap: 12 }} data-testid="plan-box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {!user ? "Plans" : trial ? `⭐ Pro trial: ${trialDaysLeft(trial.endsAt)} ${trialDaysLeft(trial.endsAt) === 1 ? "day" : "days"} left` : `Your plan: ${PLAN_NAMES[tier]}`}
        </div>
        {onSale && bothPeriods && (
          <div role="radiogroup" aria-label="Billing period" data-testid="period-toggle" style={{ display: "inline-flex", border: "var(--nb-border)" }}>
            {(["monthly", "yearly"] as const).map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={interval === i}
                onClick={() => setIntervalState(i)}
                style={{ border: "none", padding: "6px 12px", fontWeight: 900, fontSize: 12, cursor: "pointer", fontFamily: "inherit", background: interval === i ? "#000" : "transparent", color: interval === i ? ACCENT : "hsl(var(--foreground))" }}
              >
                {i === "monthly" ? "Monthly" : "Yearly"}
                {i === "yearly" && saving > 0 && <span style={{ marginLeft: 6, background: ACCENT, color: "#000", padding: "0 5px", fontSize: 10 }}>save {saving}%</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {trial && (
        <div style={{ fontSize: 13, lineHeight: 1.6 }} data-testid="trial-note">
          You have every Pro feature free until {fmtDate(trial.endsAt)}. No card needed. After that you're on Free: nothing is deleted, the Pro features and higher AI limits stop. Pick a plan any time to keep them.
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {sub.endsAt
            ? `${PLAN_NAMES[tier]} until ${fmtDate(sub.endsAt)} (cancelled — you won't be charged again).`
            : sub.status === "past_due"
              ? "Your last payment didn't go through. Update your card in Manage subscription to keep your plan."
              : sub.renewsAt
                ? `Renews ${fmtDate(sub.renewsAt)} (${sub.interval === "year" ? "yearly" : "monthly"}). Thanks for supporting ProdLi!`
                : "Thanks for supporting ProdLi!"}
        </div>
      )}

      {onSale ? (
        <div className="plan-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, paddingTop: 6 }}>
          {card("free")}
          {card("pro")}
          {card("plus")}
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.8 }}>ProdLi Pro is coming soon. Everything stays free until then.</div>
      )}

      {(billing?.earlyAccess || publicPlans?.earlyAccess) && <div data-testid="pro-early-access-note" style={{ fontSize: 11, opacity: 0.8 }}>Until Pro goes on sale, the Pro features are free for everyone.</div>}

      <div>
        <button onClick={() => setCompare((c) => !c)} aria-expanded={compare} style={{ border: "none", background: "transparent", padding: 0, fontWeight: 800, fontSize: 12, cursor: "pointer", textDecoration: "underline", color: "inherit", fontFamily: "inherit" }}>
          {compare ? "▾ Hide the full comparison" : "▸ Compare every feature"}
        </button>
        {compare && (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }} data-testid="plan-compare">
            <thead>
              <tr style={{ fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ textAlign: "left" }}>Per month</th>
                <th style={{ textAlign: "right", padding: "0 6px" }}>Free</th>
                <th style={{ textAlign: "right", padding: "0 6px" }}>Pro</th>
                {limits.plus && <th style={{ textAlign: "right" }}>Plus</th>}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["AI meeting summaries", (l: PlanLimits) => l.summaries.toLocaleString()],
                  ["AI audio transcription", (l: PlanLimits) => (l.transcribeMinutes !== undefined ? `${l.transcribeMinutes.toLocaleString()} min` : "—")],
                  ["Ask ProdLi questions", (l: PlanLimits) => l.asks.toLocaleString()],
                  ["Daily briefs & reviews", (l: PlanLimits) => l.briefs.toLocaleString()],
                  ["Writing help & screenshot text", (l: PlanLimits) => (l.writes ?? 0).toLocaleString()],
                  ["Dictation AI clean-ups", (l: PlanLimits) => (l.dictations ?? 0).toLocaleString()],
                  ["Synced storage", (l: PlanLimits) => formatBytes(l.storageBytes)],
                ] as const
              ).map(([label, f]) => (
                <tr key={label} style={{ borderTop: "1px solid var(--nb-section-border)" }}>
                  <td style={{ padding: "3px 0" }}>{label}</td>
                  <td style={{ textAlign: "right", padding: "3px 6px" }}>{f(limits.free)}</td>
                  <td style={{ textAlign: "right", padding: "3px 6px", fontWeight: 800 }}>{f(limits.pro)}</td>
                  {limits.plus && <td style={{ textAlign: "right", fontWeight: 900 }}>{f(limits.plus)}</td>}
                </tr>
              ))}
              {FEATURES.map((f) => (
                <tr key={f} style={{ borderTop: "1px solid var(--nb-section-border)" }}>
                  <td style={{ padding: "3px 0" }}>{f}</td>
                  <td style={{ textAlign: "right", padding: "3px 6px" }}>—</td>
                  <td style={{ textAlign: "right", padding: "3px 6px" }}>✓</td>
                  {limits.plus && <td style={{ textAlign: "right" }}>✓</td>}
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--nb-section-border)" }}>
                <td style={{ padding: "3px 0" }}>Shared notes links that never expire</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>7 or 30 days</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>✓</td>
                {limits.plus && <td style={{ textAlign: "right" }}>✓</td>}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {billing?.canManage && subscribed && (
        <div>
          <button style={{ ...btn(false, !!busy), width: "auto" }} disabled={!!busy} onClick={() => void openPortal().catch((e: Error) => setNote({ tone: "error", text: e.message }))}>
            Manage subscription
          </button>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>Change your card, download invoices, or cancel — on Dodo Payments' secure page.</div>
        </div>
      )}
      {onSale && (
        <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.5 }}>
          Prices in US dollars; checkout shows your local price and any tax. Payments by Dodo Payments, our reseller (merchant of record): it handles tax and invoices. Cancel any time; your plan stays on until the end of the period you paid for.
        </div>
      )}
      {note && (
        <div role="status" data-testid="plan-note" style={{ border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: note.tone === "ok" ? "#D7F5D7" : "#FFCDD2", color: "#000" }}>
          {note.text}
        </div>
      )}
    </div>
  );
}
