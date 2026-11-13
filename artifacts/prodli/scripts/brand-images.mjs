#!/usr/bin/env node
// Renders ProdLi's brand images from scripts/brand/*.html with headless Chrome:
//   store-assets/promo-440x280.png   Chrome Web Store small promo tile
//   ../prodli-site/public/og-image.png   link preview (1200×630) for prodli.com
// Usage (from artifacts/prodli): node scripts/brand-images.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const chrome =
  process.env.CHROME_PATH ||
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found (set CHROME_PATH)");

const shots = [
  { page: "promo.html", size: [440, 280], out: [path.join(root, "store-assets/promo-440x280.png"), path.join(root, "public/store-assets/promo-440x280.png")] },
  { page: "og.html", size: [1200, 630], out: [path.resolve(root, "../prodli-site/public/og-image.png")] },
];
for (const s of shots) {
  const tmp = path.join(mkdtempSync(path.join(tmpdir(), "prodli-brand-")), "shot.png");
  execFileSync(chrome, ["--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", `--user-data-dir=${path.dirname(tmp)}`, `--window-size=${s.size.join(",")}`, `--screenshot=${tmp}`, "--virtual-time-budget=2000", pathToFileURL(path.join(here, "brand", s.page)).href], { stdio: "ignore" });
  for (const o of s.out) copyFileSync(tmp, o);
  console.log(`✓ ${s.page} → ${s.out.map((o) => path.relative(root, o)).join(", ")}`);
}
