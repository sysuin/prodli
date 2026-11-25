// app.prodli.com/?desktop=signin&… — signs the ProdLi desktop app in, and
// app.prodli.com/?extension=signin&… the extension in a browser without Chrome's
// own Google sign-in (Edge, Brave, Opera…). The user signs in here (if they
// aren't already), then confirms; the page gets a one-time code and hands it to
// the app on this computer, or to the extension (lib/desktopHandoff.ts).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { accountRequest, refreshAccount, renderGoogleButton, type ProdliUser } from "../lib/prodliAccount";
import { loopbackCallback, type DesktopHandoff as Handoff, type ExtensionHandoff } from "../lib/desktopHandoff";
import { LogoMark } from "./Logo";

const btn: CSSProperties = {
  border: "3px solid #000",
  boxShadow: "5px 5px 0 #000",
  background: "#FFD700",
  color: "#000",
  padding: "14px 28px",
  fontWeight: 900,
  fontSize: 16,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  fontFamily: "inherit",
};

type Target = { kind: "desktop"; handoff: Handoff } | { kind: "extension"; handoff: ExtensionHandoff };

/** chrome.runtime on a web page: there when an installed extension lets app.prodli.com message it. */
type PageRuntime = { sendMessage(id: string, msg: unknown, cb: (reply: unknown) => void): void; lastError?: { message?: string } };
const pageRuntime = (): PageRuntime | null => (globalThis as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime ?? null;

/** Hands the code to the extension; resolves with its answer. */
function sendToExtension(h: ExtensionHandoff, code: string): Promise<{ ok: boolean; error?: string }> {
  const rt = pageRuntime();
  if (!rt?.sendMessage) return Promise.resolve({ ok: false, error: "Couldn't reach ProdLi in this browser. Make sure the extension is installed and up to date, then start again from it." });
  return new Promise((resolve) => {
    rt.sendMessage(h.extensionId, { type: "prodli-signin", code, state: h.state }, (reply) => {
      const r = reply as { ok?: boolean; error?: string } | undefined;
      if (rt.lastError || !r) resolve({ ok: false, error: "Couldn't reach ProdLi in this browser. Make sure the extension is installed and up to date, then start again from it." });
      else resolve({ ok: !!r.ok, error: r.error });
    });
  });
}

export function DesktopHandoff(props: { handoff: Handoff } | { target: Target }) {
  const target: Target = "target" in props ? props.target : { kind: "desktop", handoff: props.handoff };
  const ext = target.kind === "extension";
  const [user, setUser] = useState<ProdliUser | null | undefined>(undefined);
  const [step, setStep] = useState<"ready" | "sending" | "sent">("ready");
  const [error, setError] = useState<string | null>(null);
  const googleBtn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = ext ? "Sign in to ProdLi in this browser" : "Sign in to the ProdLi app";
    void refreshAccount().then(setUser);
  }, []);

  useEffect(() => {
    if (user !== null || !googleBtn.current) return;
    const host = document.createElement("div");
    googleBtn.current.appendChild(host);
    let cancelled = false;
    renderGoogleButton(host, setUser, (e) => setError(e.message)).catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      host.remove();
    };
  }, [user]);

  const open = async () => {
    setStep("sending");
    setError(null);
    try {
      if (target.kind === "extension") {
        const h = target.handoff;
        const { code } = await accountRequest<{ code: string }>("/api/auth/desktop/code", { method: "POST", body: JSON.stringify({ challenge: h.challenge, extensionId: h.extensionId }) }, { unknown_extension: "This isn't ProdLi's extension, so it can't sign in here." });
        const r = await sendToExtension(h, code);
        if (!r.ok) throw new Error(r.error || "ProdLi couldn't finish signing in. Start again from the extension.");
        setStep("sent");
        return;
      }
      const { code } = await accountRequest<{ code: string }>("/api/auth/desktop/code", { method: "POST", body: JSON.stringify({ challenge: target.handoff.challenge }) });
      setStep("sent");
      location.href = loopbackCallback(target.handoff, code);
    } catch (err) {
      setStep("ready");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  return (
    <main data-testid="desktop-handoff" style={{ minHeight: "100vh", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "Space Grotesk, Inter, sans-serif" }}>
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center", border: "var(--nb-border)", background: "hsl(var(--card))", boxShadow: "8px 8px 0 #000", padding: "32px 28px" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <LogoMark size={48} />
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.02em", margin: "14px 0 8px" }}>{ext ? "Sign in to ProdLi in this browser" : "Sign in to the ProdLi app"}</h1>
        {user === undefined ? (
          <p style={{ fontSize: 14 }}>Loading…</p>
        ) : user === null ? (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 18px" }}>First, sign in to your ProdLi account.</p>
            <div ref={googleBtn} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />
          </>
        ) : step === "sent" ? (
          <p role="status" style={{ fontSize: 15, lineHeight: 1.6, fontWeight: 600 }}>
            {ext ? "Done — ProdLi in this browser is signed in. You can close this tab." : "Done — you're signed in to the ProdLi app. You can close this tab."}
          </p>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 6px" }}>
              Signed in as <strong>{user.email}</strong>.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
              {ext ? "This lets the ProdLi extension in this browser use your account: your notes, to-dos, meetings and settings sync with it." : "This lets the ProdLi app on this computer use your account: your notes, to-dos, meetings and settings sync with it."}
            </p>
            <button autoFocus style={btn} disabled={step === "sending"} onClick={() => void open()} data-testid="handoff-confirm">
              {step === "sending" ? (ext ? "Connecting…" : "Opening…") : ext ? "Connect ProdLi" : "Open ProdLi"}
            </button>
            <p style={{ fontSize: 12, opacity: 0.75, marginTop: 18, lineHeight: 1.5 }}>{ext ? "Didn't start this from the ProdLi extension? Just close this tab." : "Didn't start this from the ProdLi app? Just close this tab."}</p>
          </>
        )}
        {error && (
          <div role="alert" style={{ marginTop: 16, border: "var(--nb-border)", padding: "8px 12px", fontSize: 13, fontWeight: 700, background: "#FFCDD2", color: "#000" }}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
