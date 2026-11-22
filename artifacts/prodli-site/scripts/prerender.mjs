#!/usr/bin/env node
// Writes a real HTML file for every page of prodli.com into dist/public, after
// `vite build` (the browser app) and `vite build --ssr` (src/entry-server.tsx):
//   /                    → index.html
//   /privacy             → privacy.html            (Cloudflare serves /privacy from it)
//   /ai-meeting-notes/zoom → ai-meeting-notes/zoom.html
//   unknown pages        → 404.html                (served with status 404 by worker/index.js)
// Each file has the page's own title, description, canonical link and preview
// tags, and its content already rendered; the browser app then takes over.
// Also writes sitemap.xml from the same list (src/seo.ts).

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const out = path.join(site, "dist/public");
const serverDir = path.join(site, "dist/server");
const ORIGIN = "https://prodli.com";

const { render, PAGES, NOT_FOUND } = await import(pathToFileURL(path.join(serverDir, "entry-server.js")).href);
const template = readFileSync(path.join(out, "index.html"), "utf8");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function page(html, meta, body) {
  const url = meta.path === "/" ? ORIGIN : `${ORIGIN}${meta.path}`;
  const set = (re, value, what) => {
    if (!re.test(html)) throw new Error(`index.html has no ${what}`);
    html = html.replace(re, value);
  };
  set(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`, "<title>");
  set(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(meta.description)}" />`, "description");
  set(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`, "canonical link");
  set(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`, "og:url");
  set(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)}" />`, "og:title");
  set(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.description)}" />`, "og:description");
  set(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`, "twitter:title");
  set(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`, "twitter:description");
  if (!meta.inSitemap) set(/<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="noindex" />`, "robots");
  set(/<div id="root"><\/div>/, `<div id="root">${body}</div>`, "root element");
  return html;
}

const fileFor = (p) => (p === "/" ? "index.html" : `${p.slice(1)}.html`);

for (const meta of [...PAGES, NOT_FOUND]) {
  const body = render(meta.path === NOT_FOUND.path ? "/this-page-does-not-exist" : meta.path);
  if (!body || body.length < 200) throw new Error(`${meta.path} rendered almost nothing`);
  const file = path.join(out, fileFor(meta.path));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, page(template, meta, body));
  console.log(`  ${meta.path.padEnd(32)} → ${path.relative(out, file)}`);
}

const urls = PAGES.filter((p) => p.inSitemap)
  .map((p) => `  <url><loc>${p.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${p.path}`}</loc></url>`)
  .join("\n");
writeFileSync(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
rmSync(serverDir, { recursive: true, force: true });
console.log("✓ Pre-rendered pages and sitemap.xml");
