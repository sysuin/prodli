import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { main, operationIdFrom } from "../../scripts/edge-store.mjs";

const PRODUCT = "d34f98f5-f9b7-42b1-bebb-98707202b21d";
const ENV = { EDGE_CLIENT_ID: "client-1", EDGE_API_KEY: "key-1", EDGE_PRODUCT_ID: PRODUCT };
const BASE = `https://api.addons.microsoftedge.microsoft.com/v1/products/${PRODUCT}/submissions`;

type Reply = { status?: number; body?: unknown; location?: string };
function fakeEdge(routes: [method: string, url: string, replies: Reply[]][]) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const route = routes.find(([m, u]) => m === method && u === url);
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    const r = route[2].length > 1 ? route[2].shift()! : route[2][0];
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.location ? { Location: r.location } : {} });
  };
  return { calls, fetchImpl };
}

async function run(args: string[], routes: [string, string, Reply[]][], env: Record<string, string> = ENV) {
  const edge = fakeEdge(routes);
  const lines: string[] = [];
  const code = await main(args, { env, fetchImpl: edge.fetchImpl, log: (l: string) => lines.push(l), readZip: () => new Uint8Array([80, 75, 3, 4]), pollMs: 1, waitMs: 10, sleep: async () => {} });
  return { code, out: lines.join("\n"), calls: edge.calls };
}

const UPLOAD: [string, string, Reply[]] = ["POST", `${BASE}/draft/package`, [{ status: 202, location: "op-up-1" }]];
const UPLOAD_OK: [string, string, Reply[]] = ["GET", `${BASE}/draft/package/operations/op-up-1`, [{ body: { status: "InProgress" } }, { body: { status: "Succeeded", message: "Successfully updated package to prodli.zip" } }]];

describe("edge-store.mjs (Edge Add-ons API v1.1)", () => {
  it("upload: sends the zip with the API key and client ID, waits for it, and stops at the draft", async () => {
    const { code, out, calls } = await run(["upload", "x.zip"], [UPLOAD, UPLOAD_OK]);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/draft/package`, headers: { Authorization: "ApiKey key-1", "X-ClientID": "client-1", "Content-Type": "application/zip" } });
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
    expect(out).toContain("Successfully updated package");
    expect(out).toContain("press Publish there");
  });

  it("submit: uploads, then publishes the draft with notes for certification", async () => {
    const { code, out, calls } = await run(["submit", "x.zip", "ProdLi 1.5.1"], [UPLOAD, UPLOAD_OK, ["POST", BASE, [{ status: 202, location: `${BASE}/operations/op-pub-9` }]], ["GET", `${BASE}/operations/op-pub-9`, [{ body: { status: "Succeeded", message: "Submitted" } }]]]);
    expect(code).toBe(0);
    const pub = calls.find((c) => c.method === "POST" && c.url === BASE)!;
    expect(JSON.parse(String(pub.body))).toEqual({ notes: "ProdLi 1.5.1" });
    expect(out).toContain("Submitted for certification");
  });

  it("a failed upload says why and is never submitted", async () => {
    const { code, out, calls } = await run(["submit", "x.zip"], [UPLOAD, ["GET", `${BASE}/draft/package/operations/op-up-1`, [{ body: { status: "Failed", message: "Package is invalid.", errorCode: "InvalidPackage", errors: ["The manifest version must be higher"] } }]]]);
    expect(code).toBe(1);
    expect(out).toContain("Upload failed: Package is invalid. — InvalidPackage — The manifest version must be higher");
    expect(calls.some((c) => c.method === "POST" && c.url === BASE)).toBe(false);
  });

  it("explains a rejected or expired API key, and a submission already in review", async () => {
    const key = await run(["upload", "x.zip"], [["POST", `${BASE}/draft/package`, [{ status: 401, body: {} }]]]);
    expect(key.code).toBe(1);
    expect(key.out).toContain("API keys expire");
    const busy = await run(["submit", "x.zip"], [UPLOAD, UPLOAD_OK, ["POST", BASE, [{ status: 202, location: "op-pub-2" }]], ["GET", `${BASE}/operations/op-pub-2`, [{ body: { status: "Failed", message: "Can't publish extension as your extension submission is in progress.", errorCode: "InProgressSubmission" } }]]]);
    expect(busy.code).toBe(1);
    expect(busy.out).toContain("InProgressSubmission");
  });

  it("gives up waiting after a while", async () => {
    const { code, out } = await run(["upload", "x.zip"], [UPLOAD, ["GET", `${BASE}/draft/package/operations/op-up-1`, [{ body: { status: "InProgress" } }]]]);
    expect(code).toBe(1);
    expect(out).toContain("still in progress");
  });

  it("names missing settings, checks the product ID, and prints usage for a wrong command", async () => {
    expect((await run(["upload", "x.zip"], [], {})).out).toContain("Missing settings: EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID");
    expect((await run(["upload", "x.zip"], [], { ...ENV, EDGE_PRODUCT_ID: "nope" })).out).toContain("EDGE_PRODUCT_ID should look like");
    expect((await run(["status"], [])).code).toBe(2);
  });

  it("reads the operation ID from an ID or a URL", () => {
    expect(operationIdFrom("abc-123")).toBe("abc-123");
    expect(operationIdFrom(`${BASE}/draft/package/operations/abc-123/`)).toBe("abc-123");
    expect(() => operationIdFrom(null)).toThrow(/Location/);
  });
});
