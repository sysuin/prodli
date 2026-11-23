// Settings → Connections: API keys (personal access tokens) that let Claude,
// ChatGPT, Cursor or the user's own scripts read their ProdLi data through
// the read-only API and MCP server (prodli-api: src/apiTokens.ts, src/mcp.ts,
// docs/API.md). Keys can only read; they can't sign in, sync or change anything.

import { useEffect, useId, useState, type CSSProperties } from "react";
import { createApiToken, listApiTokens, revokeApiToken, serverOrigin, type ApiToken } from "../lib/prodliAccount";
import { box, btn, sectionTitle, SignInFirst, useAction, useProdliUser } from "./AccountModal";

const PLACEHOLDER = "plt_YOUR_KEY";

const code: CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  border: "var(--nb-border)",
  background: "hsl(var(--background))",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  overflowX: "auto",
};

function CopyBlock({ label, text, testId }: { label: string; text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800 }}>{label}</span>
        <button style={{ ...btn(), padding: "3px 8px", fontSize: 11 }} onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={code} data-testid={testId}>
        {text}
      </pre>
    </div>
  );
}

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never");

export function ConnectionsSection({ onSignIn }: { onSignIn: () => void }) {
  const id = useId();
  const [user] = useProdliUser();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [max, setMax] = useState(10);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ token: string; apiToken: ApiToken } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { busy, act, setMessage, status } = useAction();

  useEffect(() => {
    if (!user) return setTokens(null);
    listApiTokens().then(
      (r) => (setTokens(r.tokens), setMax(r.max)),
      () => setTokens([]),
    );
  }, [user]);

  if (user === undefined) return <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>;
  if (!user) return <SignInFirst what="Sign in to connect Claude, ChatGPT or your own scripts to your ProdLi to-dos, notes and meetings." onSignIn={onSignIn} />;

  const origin = serverOrigin();
  const mcpUrl = `${origin}/mcp`;
  const key = fresh?.token ?? PLACEHOLDER;
  const full = (tokens?.length ?? 0) >= max;

  const create = () =>
    void act("create", async () => {
      const made = await createApiToken(name.trim() || "My key");
      setFresh(made);
      setName("");
      setTokens((t) => [made.apiToken, ...(t ?? [])]);
    });
  const revoke = (t: ApiToken) =>
    void act(`revoke-${t.id}`, async () => {
      await revokeApiToken(t.id);
      setTokens((list) => (list ?? []).filter((x) => x.id !== t.id));
      if (fresh?.apiToken.id === t.id) setFresh(null);
      setConfirming(null);
      setMessage({ tone: "ok", text: `Revoked "${t.name}". Anything using it can't read your data any more.` });
    });

  const desktopConfig = JSON.stringify(
    { mcpServers: { prodli: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${PRODLI_AUTH}"], env: { PRODLI_AUTH: `Bearer ${key}` } } } },
    null,
    2,
  );
  const cursorConfig = JSON.stringify({ mcpServers: { prodli: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);

  return (
    <div style={{ display: "grid", gap: 16 }} data-testid="connections">
      <div style={box}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          Let Claude, ChatGPT or your own scripts read your ProdLi to-dos, notes and meetings. <b>Read-only:</b> they can't change or delete anything.
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.8 }}>
          A connected app can read your to-dos and lists, notes, meeting summaries and transcripts, habits and today's plan — whatever is synced to your account. Not your calendar, Time Tracker or files. What it reads goes to that app (for example Anthropic or OpenAI) under its own privacy terms. Create one key per app, so you can revoke each on its own.
        </div>
      </div>

      <div style={box}>
        <div style={sectionTitle}>Create an API key</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor={`${id}-name`} style={{ fontSize: 13, fontWeight: 700 }}>
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && !full && create()}
            placeholder="Claude Desktop"
            style={{ flex: "1 1 180px", border: "var(--nb-border)", padding: "7px 10px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--background))", color: "inherit" }}
          />
          <button style={btn(true, !!busy || full)} disabled={!!busy || full} onClick={create}>
            Create key
          </button>
        </div>
        {full && <div style={{ fontSize: 12 }}>You have {max} keys, the most allowed. Revoke one to make another.</div>}
        {fresh && (
          <div style={{ display: "grid", gap: 6, border: "var(--nb-border)", background: "#FFF7C2", color: "#000", padding: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Copy "{fresh.apiToken.name}" now. You won't see it again.</div>
            <CopyBlock label="Your new key" text={fresh.token} testId="new-token" />
            <div style={{ fontSize: 12 }}>Keep it secret, like a password: anyone with it can read your ProdLi data. The setup steps below already include it.</div>
          </div>
        )}
      </div>

      <div style={box}>
        <div style={sectionTitle}>Your keys</div>
        {tokens === null ? (
          <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>
        ) : tokens.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.75 }}>No keys yet.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} data-testid="api-tokens">
            {tokens.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: "1px dashed hsl(var(--border))", paddingBottom: 8 }}>
                <span style={{ fontSize: 13 }}>
                  <b>{t.name}</b> <code style={{ fontSize: 12, opacity: 0.75 }}>{t.prefix}…</code>
                  <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>
                    Created {when(t.createdAt)} · Last used {when(t.lastUsedAt)}
                  </span>
                </span>
                {confirming === t.id ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button style={btn(true, !!busy)} disabled={!!busy} onClick={() => revoke(t)}>
                      Revoke now
                    </button>
                    <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => setConfirming(t.id)} aria-label={`Revoke ${t.name}`}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div style={{ fontSize: 11, opacity: 0.7 }}>"Sign out everywhere" and deleting your account also revoke every key.</div>
        {status}
      </div>

      <div style={box}>
        <div style={sectionTitle}>Set it up</div>
        {!fresh && <div style={{ fontSize: 12, opacity: 0.8 }}>Replace {PLACEHOLDER} with your key (create one above and the steps fill it in).</div>}
        <CopyBlock label="MCP server URL" text={mcpUrl} testId="mcp-url" />
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <b>Claude Desktop:</b> Settings → Developer → Edit Config, add this to <code>claude_desktop_config.json</code>, then restart Claude. Needs Node.js.
        </div>
        <CopyBlock label="claude_desktop_config.json" text={desktopConfig} />
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <b>Cursor</b> (<code>~/.cursor/mcp.json</code>) and other apps that take a URL and headers:
        </div>
        <CopyBlock label="mcp.json" text={cursorConfig} />
        <CopyBlock label="Claude Code" text={`claude mcp add --transport http prodli ${mcpUrl} --header "Authorization: Bearer ${key}"`} />
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <b>Claude.ai and ChatGPT</b> (custom connectors take only a URL): use this address with the key in it. Anyone who sees this URL can read your data, so use a key just for this, and revoke it if the URL ever leaks.
        </div>
        <CopyBlock label="Connector URL (contains your key)" text={`${mcpUrl}/${key}`} />
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <b>Your own scripts:</b> the same data as JSON from <code>/api/v1/</code> (todos, notes, meetings, habits, today).
        </div>
        <CopyBlock label="curl" text={`curl -H "Authorization: Bearer ${key}" ${origin}/api/v1/todos`} />
      </div>
    </div>
  );
}
