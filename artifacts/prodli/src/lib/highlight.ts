// Syntax highlighting for the Files previewer (loaded on demand).
// highlight.js escapes the input and only emits <span class="hljs-…">, so the
// output is safe to insert as HTML.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS = { bash, c, cpp, csharp, css, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

const BY_EXT: Record<string, keyof typeof LANGS> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  json: "json", jsonc: "json", geojson: "json", map: "json", webmanifest: "json",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  swift: "swift", php: "php", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  css: "css", scss: "css", less: "css",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", conf: "ini", env: "bash",
  sh: "bash", bash: "bash", zsh: "bash", sql: "sql", md: "markdown", markdown: "markdown",
};

/** Max size we highlight (bigger files stay plain to keep the preview fast). */
export const MAX_HIGHLIGHT_CHARS = 400_000;

export function languageForExt(ext: string): string | null {
  return BY_EXT[ext.toLowerCase()] ?? null;
}

/** Highlighted HTML for `text`, or null if the language is unknown or the file is too big. */
export function highlightCode(text: string, language: string | null): string | null {
  if (!language || text.length > MAX_HIGHLIGHT_CHARS || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
