// Opening local files in ProdLi's Files viewer: File → Open, "Open With → ProdLi"
// in Finder / Explorer, or a file dropped on the dock icon. Files are read on
// this computer and shown; nothing is uploaded.

import path from "node:path";

/** The file types the viewer handles (the same list as the extension's "open anywhere"). */
export const OPENABLE_EXTENSIONS = [
  "md", "markdown", "mdown", "mkd", "mdx",
  "json", "geojson", "jsonl", "ndjson", "ipynb", "har",
  "csv", "tsv",
  "txt", "log", "text",
  "yaml", "yml", "toml", "ini", "env", "conf", "cfg",
  "xml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "cs", "php", "sql", "sh", "zsh", "css", "scss",
];

/** Big enough for real notes and data, small enough not to freeze the page. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function isOpenablePath(p: string): boolean {
  const ext = path.extname(p).slice(1).toLowerCase();
  return !!ext && OPENABLE_EXTENSIONS.includes(ext);
}

/** File paths in a command line (Windows / Linux "Open With" passes them as arguments). */
export function filesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith("-") && isOpenablePath(a));
}

const MIME: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", jsonl: "application/x-ndjson", ndjson: "application/x-ndjson", txt: "text/plain", log: "text/plain", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml" };
export const mimeFor = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] ?? "text/plain";
