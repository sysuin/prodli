#!/usr/bin/env node
// Checks the "which app is in front" query used by Time Tracker › Apps works on
// this machine (CI runs it on macOS and Windows). Prints the app it saw; fails
// if the command errors or prints nothing within 20 s. (On a CI machine with no
// window in front, an empty name is fine: the command itself must work.)
import { execFile, spawn } from "node:child_process";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = await build({ entryPoints: [path.join(here, "../src/core/appUsage.ts")], bundle: true, write: false, format: "esm", platform: "node" });
const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const done = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  process.exit(ok ? 0 : 1);
};
setTimeout(() => done(false, "no answer within 20 s"), 20_000);

if (process.platform === "darwin") {
  execFile("osascript", ["-l", "JavaScript", "-e", mod.MAC_FRONT_APP_SCRIPT], (err, stdout) => (err ? done(false, err.message) : done(true, `front app: "${String(stdout).trim()}"`)));
} else if (process.platform === "win32") {
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", mod.encodePowerShell(mod.windowsForegroundScript(1))], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  ps.stderr.on("data", (d) => (err += d));
  ps.stdout.setEncoding("utf8");
  ps.stdout.once("data", (line) => {
    ps.kill();
    done(true, `foreground app: "${line.trim()}"`);
  });
  ps.on("exit", (code) => code && done(false, `powershell exited ${code}: ${err.slice(0, 300)}`));
} else {
  done(true, "not used on this platform");
}
