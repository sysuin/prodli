// A meeting's "🔗 Share" panel: a read-only link to its summary (never the
// transcript or audio) for people who weren't there. Server: /api/shares and
// the public page /s/<id> (prodli-api/src/shares.ts). The link is kept on the
// meeting (synced), so every device shows it.

import { useEffect, useState, type CSSProperties } from "react";
import { accountRequest, AccountError } from "../../lib/prodliAccount";
import { updateMeeting } from "../../recorder/db";
import type { Meeting } from "../../recorder/types";
import { ProBadge, useProAccess } from "../../components/Pro";

const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#FF4FA3" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "6px 12px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
});

type Expiry = "7" | "30" | "never";
interface ShareInfo {
  id: string;
  url: string;
  expiresAt: number | null;
  views: number;
}

/** What's sent: the summary only (server: ShareInputSchema). */
export function sharePayload(m: Meeting, expiry: Expiry) {
  const s = m.summary!;
  return {
    meetingId: m.id,
    title: (s.title || m.title).slice(0, 300),
    date: new Date(m.startedAt).toISOString().slice(0, 10),
    durationSec: Math.max(0, Math.min(m.durationSec || 0, 24 * 3600)),
    expiresDays: expiry === "never" ? null : Number(expiry),
    summary: {
      overview: s.overview.slice(0, 4000),
      keyPoints: s.keyPoints.slice(0, 30).map((x) => x.slice(0, 600)),
      decisions: s.decisions.slice(0, 20).map((x) => x.slice(0, 600)),
      actionItems: s.actionItems.slice(0, 40).map((a) => ({ task: a.task.slice(0, 400), owner: a.owner?.slice(0, 120) ?? null, dueDate: a.dueDate?.slice(0, 10) ?? null })),
      openQuestions: s.openQuestions.slice(0, 20).map((x) => x.slice(0, 600)),
      ...(s.customSections?.length ? { customSections: s.customSections.slice(0, 8).map((c) => ({ heading: c.heading.slice(0, 80), points: c.points.slice(0, 20).map((p) => p.slice(0, 600)) })) } : {}),
    },
  };
}

const until = (t: number | null) => (t ? `until ${new Date(t).toLocaleDateString([], { day: "numeric", month: "short" })}` : "no expiry");

export function ShareMeeting({ meeting, flash, onClose }: { meeting: Meeting; flash: (msg: string) => void; onClose: () => void }) {
  const access = useProAccess();
  const [expiry, setExpiry] = useState<Expiry>("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<ShareInfo | null>(meeting.share ? { ...meeting.share, views: 0 } : null);
  const neverAllowed = !!access?.allowed;

  // Fresh status (views, or a link stopped on another device).
  useEffect(() => {
    if (!meeting.share) return;
    void accountRequest<{ shares: (ShareInfo & { meetingId: string })[] }>("/api/shares")
      .then((r) => {
        const mine = r.shares.find((x) => x.meetingId === meeting.id) ?? null;
        setInfo(mine);
        if (!mine) void updateMeeting(meeting.id, () => ({ share: undefined }));
      })
      .catch(() => {});
  }, [meeting.id, meeting.share]);

  const copy = (url: string) =>
    navigator.clipboard.writeText(url).then(
      () => flash("Link copied"),
      () => flash("Couldn't copy: select the link and copy it"),
    );

  const share = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await accountRequest<{ share: ShareInfo }>("/api/shares", { method: "POST", body: JSON.stringify(sharePayload(meeting, expiry)) });
      setInfo(r.share);
      await updateMeeting(meeting.id, () => ({ share: { id: r.share.id, url: r.share.url, expiresAt: r.share.expiresAt } }));
      await copy(r.share.url);
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Sharing didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!info) return;
    setBusy(true);
    try {
      await accountRequest(`/api/shares/${encodeURIComponent(info.id)}`, { method: "DELETE" }).catch((err: unknown) => {
        if (!(err instanceof AccountError && err.status === 404)) throw err;
      });
      setInfo(null);
      await updateMeeting(meeting.id, () => ({ share: undefined }));
      flash("Stopped sharing");
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Couldn't stop sharing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="share-meeting" style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 12, marginTop: 10, display: "grid", gap: 8, fontSize: 13 }}>
      <div style={{ fontWeight: 800 }}>🔗 Share these notes</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Anyone with the link can read the summary, decisions and action items. The transcript and audio are never shared.</div>
      {info && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input readOnly value={info.url} aria-label="Shared link" onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 240px", minWidth: 0, border: "var(--nb-border)", padding: "5px 8px", fontFamily: "inherit", fontSize: 12, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
          <button style={btn()} onClick={() => void copy(info.url)}>Copy link</button>
          <span data-testid="share-status" style={{ fontSize: 11, opacity: 0.8 }}>
            Shared, {until(info.expiresAt)}
            {info.views ? ` · ${info.views} view${info.views === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
          Link works for
          <select value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)} style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "3px 4px" }}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="never" disabled={!neverAllowed}>No expiry (Pro){neverAllowed ? "" : " 🔒"}</option>
          </select>
        </label>
        {!neverAllowed && access?.signedIn && <ProBadge />}
        <button style={btn(true, busy)} disabled={busy} onClick={() => void share()}>
          {busy ? "Working…" : info ? "Update shared page" : "Create link"}
        </button>
        {info && (
          <button style={{ ...btn(false, busy), color: "var(--danger-text)" }} disabled={busy} onClick={() => void stop()}>
            Stop sharing
          </button>
        )}
        <button style={btn()} onClick={onClose}>
          Close
        </button>
      </div>
      {access?.earlyAccess && <div style={{ fontSize: 11, opacity: 0.75 }}>Links with no expiry are a ProdLi Pro feature, free for everyone while Pro is launching.</div>}
      {error && (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
