// prodli.com/goodbye — Chrome opens this after someone removes the extension
// (chrome.runtime.setUninstallURL in artifacts/prodli/src/background.ts, with
// ?v=<version>). One tap on a reason, optional words; anonymous. Answers go to
// POST app.prodli.com/api/feedback/uninstall (artifacts/prodli-api/src/insights.ts),
// which keeps only the reason, the words and the version.

import { useEffect, useState } from "react";
import { CHROME_STORE_URL, Shell } from "../components/Shell";

const API = "https://app.prodli.com/api/feedback/uninstall";

const REASONS: [string, string][] = [
  ["not_using", "I wasn't using it"],
  ["missing_feature", "It's missing something I need"],
  ["meeting_notes", "Meeting notes didn't work for me"],
  ["too_complex", "Too much going on / hard to use"],
  ["bugs", "Something was broken or slow"],
  ["privacy", "Privacy or permissions worries"],
  ["switched", "I switched to another app"],
  ["other", "Something else"],
];

export function Goodbye() {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [version, setVersion] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    setVersion(new URLSearchParams(window.location.search).get("v") ?? "");
  }, []);

  const send = async () => {
    if (!reason) return;
    setState("sending");
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, details, version }) });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };

  return (
    <Shell cta={false}>
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "56px 24px 72px" }}>
        {state === "sent" ? (
          <div className="nb-card" style={{ padding: "32px 32px", boxShadow: "var(--shadow)", textAlign: "center" }} data-testid="goodbye-thanks">
            <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-0.02em", margin: "0 0 12px" }}>Thank you.</h1>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: "#5a3e20" }}>
              Every answer is read. If you change your mind, ProdLi is one click away, and if you had an account, your synced data is still there until you delete it.
            </p>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn nb-btn-ghost" style={{ fontSize: 12, padding: "10px 20px", marginTop: 20 }}>
              Reinstall ProdLi
            </a>
          </div>
        ) : (
          <>
            <h1 style={{ fontWeight: 900, fontSize: "clamp(28px, 5vw, 40px)", letterSpacing: "-0.02em", margin: "0 0 12px" }}>Sorry to see you go.</h1>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: "#5a3e20", marginBottom: 28 }}>Why did you remove ProdLi? One tap helps us fix the right thing. It's anonymous.</p>
            <div role="radiogroup" aria-label="Reason" style={{ display: "grid", gap: 10 }}>
              {REASONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={reason === id}
                  onClick={() => setReason(id)}
                  className="nb-card"
                  style={{ textAlign: "left", padding: "14px 18px", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: reason === id ? "var(--shadow)" : "var(--shadow-sm)", background: reason === id ? "var(--yellow)" : undefined }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label style={{ display: "block", marginTop: 24, fontSize: 13, fontWeight: 800 }}>
              Anything else? (optional)
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="What would have made you keep it? Please don't include personal details."
                style={{ display: "block", width: "100%", marginTop: 8, border: "var(--border)", padding: 12, fontFamily: "inherit", fontSize: 14, background: "#fff", boxSizing: "border-box" }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
              <button type="button" className="nb-btn" disabled={!reason || state === "sending"} onClick={() => void send()} style={{ fontSize: 13, padding: "12px 26px", opacity: reason ? 1 : 0.5, cursor: reason ? "pointer" : "not-allowed" }}>
                {state === "sending" ? "Sending…" : "Send"}
              </button>
              {state === "failed" && (
                <span role="alert" style={{ fontSize: 13, fontWeight: 600 }}>
                  Couldn't send. Try again, or email contact@prodli.com.
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 28, lineHeight: 1.6 }}>
              We keep only the reason, your words and the ProdLi version. Your name, email and IP address aren't stored with your answer. <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy policy</a>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
