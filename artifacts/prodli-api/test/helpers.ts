// Test helpers: a real (in-memory, local) D1 database from Wrangler, with the
// migrations applied, and a fake Google that accepts "good:<sub>:<email>" tokens.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { AiError } from "../src/ai";
import { BillingError } from "../src/billing";
import { GoogleAuthError, type GoogleIdentity } from "../src/google";
import { createApp, type Deps, type Env } from "../src/app";
import { fakeUserStoreNamespace } from "./userStoreFake";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

export async function makeEnv(): Promise<{ env: Env; dispose: () => Promise<void> }> {
  const assets = path.join(pkg, "app-dist");
  if (!existsSync(assets)) mkdirSync(assets, { recursive: true });
  const proxy = await getPlatformProxy<Env>({ configPath: path.join(pkg, "wrangler.jsonc"), persist: false });
  for (const file of readdirSync(path.join(pkg, "migrations")).sort()) {
    const sql = readFileSync(path.join(pkg, "migrations", file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await proxy.env.DB.prepare(stmt).run();
  }
  const env: Env = {
    ENV: "staging",
    DB: proxy.env.DB,
    GOOGLE_EXTENSION_CLIENT_ID: "ext-client",
    GOOGLE_WEB_CLIENT_ID: "web-client",
    USER_STORE: fakeUserStoreNamespace(),
  };
  return { env, dispose: () => proxy.dispose() };
}

function fakeIdentity(token: string): GoogleIdentity {
  const [kind, sub, email, name] = token.split(":");
  if (kind !== "good" || !sub || !email) throw new GoogleAuthError("invalid_token");
  return { sub, email, name: name ?? "Test User", picture: null };
}

export function makeApp(clock = { now: 1_800_000_000_000 }) {
  const calls: { kind: string; clientId: string }[] = [];
  const deps: Deps = {
    verifyExtension: async (t, clientId) => (calls.push({ kind: "extension", clientId }), fakeIdentity(t)),
    verifyWeb: async (t, clientId) => (calls.push({ kind: "web", clientId }), fakeIdentity(t)),
    ask: async (input) => {
      calls.push({ kind: "ask", clientId: input.question });
      if (input.question === "FAIL") throw new AiError("ai_failed", "Something went wrong. Try asking again.");
      const top = input.context?.tasks[0]?.title;
      return { answer: top ? `Start with ${top}.` : "You have nothing planned.", actions: top ? [{ type: "plan_today", title: top, details: "" }] : [], model: "test" };
    },
    rewrite: async (input) => {
      calls.push({ kind: "rewrite", clientId: input.action });
      if (input.text === "FAIL") throw new AiError("ai_failed", "Something went wrong. Try again.");
      const text = input.action === "fix" ? input.text.replace(/\bteh\b/g, "the") : `${input.action}: ${input.text}`;
      return { text, changed: text !== input.text, model: "test" };
    },
    followUp: async (input) => {
      calls.push({ kind: "follow-up", clientId: input.tone });
      if (input.meeting.overview === "FAIL") throw new AiError("ai_failed", "Something went wrong. Try again.");
      return { subject: `Follow-up: ${input.meeting.title}`, body: `${input.tone} | ${input.meeting.actionItems.map((a) => a.task).join(", ")}`, model: "test" };
    },
    brief: async (ctx) => {
      calls.push({ kind: "brief", clientId: ctx.date });
      if (ctx.focus === "FAIL") throw new AiError("ai_failed", "Couldn't write the brief. Try again.");
      return { headline: `Your ${ctx.weekday}`, summary: "s", priorities: ctx.tasks.slice(0, 3).map((t) => ({ title: t.title, reason: "r" })), schedule: [], watchouts: [], habits: [], tip: "t", model: "test", generatedAt: "2026-11-01T00:00:00.000Z" };
    },
    review: async (ctx) => {
      calls.push({ kind: "review", clientId: ctx.weekStart });
      if (ctx.userNote === "FAIL") throw new AiError("ai_failed", "Couldn't write the review. Try again.");
      return { headline: `${ctx.done.length} tasks done`, summary: "s", wins: [], slipped: ctx.slipped.slice(0, 4).map((t) => ({ title: t.title, suggestion: "Plan it" })), patterns: [], nextWeek: ctx.slipped.slice(0, 3).map((t) => ({ title: t.title, reason: "r" })), habitTip: "", question: "q", model: "test", generatedAt: "2026-11-01T00:00:00.000Z" };
    },
    summarize: async (input) => {
      calls.push({ kind: "summarize", clientId: input.title });
      if (input.transcript.includes("FAIL")) throw new AiError("ai_failed", "Summarizing failed. Try again.");
      return { title: `Notes: ${input.title}`, overview: "o", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], model: "test", generatedAt: "2026-11-01T00:00:00.000Z" };
    },
    dodo: (apiKey, environment) => {
      const fail = () => {
        if (apiKey === "FAIL") throw new BillingError("Dodo answered 500");
      };
      return {
        async createCustomer({ email, userId }) {
          calls.push({ kind: "dodo-customer", clientId: `${environment}:${email}:${userId}` });
          fail();
          return `cus_${userId.slice(0, 8)}`;
        },
        async checkoutUrl({ productId, customerId, returnUrl }) {
          calls.push({ kind: "dodo-checkout", clientId: `${productId}:${customerId}:${returnUrl}` });
          fail();
          return `https://checkout.dodopayments.com/session/${productId}`;
        },
        async portalUrl(customerId) {
          calls.push({ kind: "dodo-portal", clientId: `${environment}:${customerId}` });
          fail();
          return `https://customer.dodopayments.com/${customerId}`;
        },
        async cancelNow(subscriptionId) {
          calls.push({ kind: "dodo-cancel", clientId: subscriptionId });
          fail();
        },
        async price(productId) {
          calls.push({ kind: "dodo-price", clientId: productId });
          fail();
          return productId === "pdt_year" ? { amount: 4800, currency: "USD" } : { amount: 500, currency: "USD" };
        },
      };
    },
    now: () => clock.now,
  };
  return { app: createApp(deps), clock, calls };
}

export const EXT_ORIGIN = "chrome-extension://gjgknflakhglanjaeenkmciohimnbkdp";

export function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

/** Extracts "name=value" from a Set-Cookie header for the next request. */
export function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0];
}
