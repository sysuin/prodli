#!/usr/bin/env node
// Load test for ProdLi sync against a LOCAL server (wrangler dev with the
// development-only Google stand-in), checking that many users syncing at once
// stay correct and fast. Real Cloudflare capacity is far higher than a laptop;
// this catches logic and contention problems (Durable Objects, D1, quotas).
//
//   node scripts/load-test.mjs [users=50] [rounds=20]
//   (starts its own server on port 8799 with a throwaway database)

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USERS = Number(process.argv[2] ?? 50);
const ROUNDS = Number(process.argv[3] ?? 20);
const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const api = path.join(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/prodli-api");
const state = mkdtempSync(path.join(tmpdir(), "prodli-load-"));

execSync(`pnpm exec wrangler d1 migrations apply DB --local --persist-to "${state}"`, { cwd: api, stdio: "ignore", env: { ...process.env, CI: "true" } });
const server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", state, "--var", "DEV_FAKE_GOOGLE:true", "--log-level", "error"], {
  cwd: api,
  detached: true,
  stdio: "ignore",
  env: { ...process.env, CI: "true" },
});
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  rmSync(state, { recursive: true, force: true });
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  if (i > 120) throw new Error("server didn't start");
  await new Promise((r) => setTimeout(r, 500));
}

const latencies = [];
let errors = 0;
const timed = async (fn) => {
  const t = performance.now();
  try {
    const r = await fn();
    if (!r.ok) errors++;
    return r;
  } catch {
    errors++;
  } finally {
    latencies.push(performance.now() - t);
  }
};
// Each simulated user gets its own client IP, as real users would (sign-in is limited per IP).
const post = (p, body, token, ip = "127.0.0.1") =>
  fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8787", "CF-Connecting-IP": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

console.log(`Load test: ${USERS} users × ${ROUNDS} rounds (2 devices each, 5 notes per push) against ${BASE}`);
const t0 = performance.now();
const results = await Promise.all(
  Array.from({ length: USERS }, async (_, u) => {
    const r = await post("/api/auth/google", { kind: "extension", accessToken: `good:load${u}:load${u}@example.com:Load ${u}` }, undefined, `10.0.${u >> 8}.${u & 255}`);
    const { token } = await r.json();
    const seqs = { a: 0, b: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      for (const device of ["a", "b"]) {
        const changes = Array.from({ length: 5 }, (_, i) => ({
          c: "notes",
          id: `${device}-${round}-${i}`,
          u: new Date(Date.UTC(2026, 10, 1) + round * 1000 + i).toISOString(),
          v: { id: `${device}-${round}-${i}`, content: "x".repeat(2000) },
        }));
        const res = await timed(() => post("/api/sync", { deviceId: `device-${device}-${u}`, since: seqs[device], changes }, token));
        if (res?.ok) seqs[device] = (await res.json()).seq;
      }
    }
    // Both devices must end up with every note.
    const pull = await (await post("/api/sync", { deviceId: `device-check-${u}`, since: 0, changes: [] }, token)).json();
    return pull.changes?.length === ROUNDS * 2 * 5;
  }),
);
const secs = (performance.now() - t0) / 1000;
latencies.sort((x, y) => x - y);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(0);
const correct = results.filter(Boolean).length;
console.log(`  requests: ${latencies.length} in ${secs.toFixed(1)} s (${(latencies.length / secs).toFixed(0)}/s)`);
console.log(`  latency: p50 ${pct(50)} ms · p95 ${pct(95)} ms · p99 ${pct(99)} ms`);
console.log(`  errors: ${errors}`);
console.log(`  users with complete, correct data: ${correct}/${USERS}`);
stop();
process.exit(errors || correct !== USERS ? 1 : 0);
