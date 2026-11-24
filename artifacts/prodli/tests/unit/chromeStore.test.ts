import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { main, PRODLI_EXTENSION_ID } from "../../scripts/chrome-store.mjs";

const ENV = { CWS_CLIENT_ID: "cid", CWS_CLIENT_SECRET: "secret", CWS_REFRESH_TOKEN: "refresh", CWS_PUBLISHER_ID: "pub1" };
const ITEM = `publishers/pub1/items/${PRODLI_EXTENSION_ID}`;

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Reply = { status?: number; body: unknown };

/** A fake fetch that answers by URL and records every call. */
function fakeStore(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) throw new Error(`unexpected ${url}`);
    const r = routes[key];
    const reply = Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0]) : r;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { calls, fetchImpl };
}

async function run(args: string[], routes: Record<string, Reply | Reply[]>, env: Record<string, string> = ENV) {
  const store = fakeStore(routes);
  const lines: string[] = [];
  const code = await main(args, {
    env,
    fetchImpl: store.fetchImpl,
    log: (l: string) => lines.push(l),
    readZip: () => new Uint8Array([80, 75, 3, 4]),
    uploadOptions: { pollMs: 1, sleep: async () => {} },
  });
  return { code, out: lines.join("\n"), calls: store.calls };
}

const TOKEN = { "/token": { body: { access_token: "at" } } };

describe("chrome-store.mjs (Chrome Web Store API v2)", () => {
  it("upload: gets a token, uploads the zip raw to the item, and stops at a draft", async () => {
    const { code, out, calls } = await run(["upload", "x.zip"], { ...TOKEN, [`${ITEM}:upload`]: { body: { uploadState: "SUCCEEDED", crxVersion: "1.5.0" } } });
    expect(code).toBe(0);
    expect(calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token", `https://chromewebstore.googleapis.com/upload/v2/${ITEM}:upload`]);
    expect(String(calls[0].body)).toContain("grant_type=refresh_token");
    expect(String(calls[0].body)).toContain("refresh_token=refresh");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers).toMatchObject({ Authorization: "Bearer at", "X-Goog-Upload-Protocol": "raw" });
    expect(out).toContain("Uploaded version 1.5.0");
    expect(out).toContain("draft");
  });

  it("submit: uploads, then submits for review with DEFAULT_PUBLISH", async () => {
    const { code, out, calls } = await run(["submit", "x.zip"], {
      ...TOKEN,
      [`${ITEM}:upload`]: { body: { uploadState: "SUCCEEDED", crxVersion: "1.5.1" } },
      [`${ITEM}:publish`]: { body: { state: "PENDING_REVIEW" } },
    });
    expect(code).toBe(0);
    expect(calls[2].url).toBe(`https://chromewebstore.googleapis.com/v2/${ITEM}:publish`);
    expect(JSON.parse(String(calls[2].body))).toEqual({ publishType: "DEFAULT_PUBLISH" });
    expect(out).toContain("Submitted for review: PENDING_REVIEW");
  });

  it("waits while Google is still processing, then carries on", async () => {
    const { code, calls } = await run(["submit", "x.zip"], {
      ...TOKEN,
      [`${ITEM}:upload`]: { body: { uploadState: "IN_PROGRESS", crxVersion: "1.5.1" } },
      [`${ITEM}:fetchStatus`]: [{ body: { lastAsyncUploadState: "IN_PROGRESS" } }, { body: { lastAsyncUploadState: "SUCCEEDED" } }],
      [`${ITEM}:publish`]: { body: { state: "PENDING_REVIEW" } },
    });
    expect(code).toBe(0);
    expect(calls.filter((c) => c.url.endsWith(":fetchStatus"))).toHaveLength(2);
  });

  it("a failed upload is never submitted", async () => {
    const { code, out, calls } = await run(["submit", "x.zip"], {
      ...TOKEN,
      [`${ITEM}:upload`]: { body: { uploadState: "FAILED", itemError: [{ error_detail: "version must be higher" }] } },
      [`${ITEM}:publish`]: { body: { state: "PENDING_REVIEW" } },
    });
    expect(code).toBe(1);
    expect(out).toContain("failed (FAILED)");
    expect(out).toContain("version must be higher");
    expect(calls.some((c) => c.url.endsWith(":publish"))).toBe(false);
  });

  it("API errors and expired keys come back as one readable line", async () => {
    const api = await run(["submit", "x.zip"], { ...TOKEN, [`${ITEM}:upload`]: { status: 400, body: { error: { code: 400, message: "Item is pending review" } } } });
    expect(api.code).toBe(1);
    expect(api.out).toContain("HTTP 400: Item is pending review");
    const grant = await run(["status"], { "/token": { status: 400, body: { error: "invalid_grant" } } });
    expect(grant.code).toBe(1);
    expect(grant.out).toContain("chrome-store-token.mjs");
  });

  it("missing settings are named, and nothing is sent", async () => {
    const { code, out, calls } = await run(["upload", "x.zip"], {}, { CWS_CLIENT_ID: "cid" });
    expect(code).toBe(1);
    expect(out).toContain("CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID");
    expect(calls).toHaveLength(0);
  });

  it("status reads the item; a wrong command prints usage", async () => {
    const st = await run(["status"], { ...TOKEN, [`${ITEM}:fetchStatus`]: { body: { lastAsyncUploadState: "SUCCEEDED" } } });
    expect(st.code).toBe(0);
    expect(st.out).toContain("SUCCEEDED");
    expect((await run(["publish"], {})).code).toBe(2);
    expect((await run(["upload"], {})).code).toBe(2);
  });
});
