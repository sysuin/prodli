// "Open in ProdLi": when a supported local file (Markdown, CSV, JSON, text,
// code…) is opened in Chrome — dropped on the tab bar or an empty tab, or
// opened from the address bar — ProdLi shows it in its Files viewer instead of
// Chrome's plain-text page. Files are read on this computer only.
//
// Chrome lets an extension read local files only when (1) it has the file
// host permission (asked when the user turns this on) and (2) the user turned
// on "Allow access to file URLs" for it in chrome://extensions. Without both,
// Chrome's normal behaviour is left alone.

export const OPEN_LOCAL_FILES_KEY = "openLocalFilesInProdli";
export const FILE_ORIGINS = ["file:///*"];

/** File types ProdLi's viewer handles better than Chrome (HTML, PDF, images stay with Chrome). */
const OPENABLE = new Set([
  "md", "markdown", "mdown", "mkd", "mdx",
  "json", "geojson", "jsonl", "ndjson", "ipynb", "har",
  "csv", "tsv",
  "txt", "log", "text",
  "yaml", "yml", "toml", "ini", "env", "conf", "cfg",
  "xml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "cs", "php", "sql", "sh", "zsh", "css", "scss",
]);

/** Is this a local file ProdLi should open? (file:// URL with a supported extension) */
export function isOpenableLocalFile(url: string | undefined): boolean {
  if (!url?.startsWith("file:///")) return false;
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    if (path.endsWith("/")) return false; // a folder listing
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return dot > 0 && OPENABLE.has(name.slice(dot + 1).toLowerCase());
  } catch {
    return false;
  }
}

export const fileNameOf = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file");

export interface LocalFileAccess {
  /** ProdLi has the file permission (asked when turning this on). */
  permission: boolean;
  /** "Allow access to file URLs" is on for ProdLi in chrome://extensions. */
  fileUrls: boolean;
}

export async function localFileAccess(): Promise<LocalFileAccess> {
  if (typeof chrome === "undefined" || !chrome.permissions || !chrome.extension?.isAllowedFileSchemeAccess) return { permission: false, fileUrls: false };
  const [permission, fileUrls] = await Promise.all([chrome.permissions.contains({ origins: FILE_ORIGINS }), chrome.extension.isAllowedFileSchemeAccess()]);
  return { permission, fileUrls };
}

/** Reads a local file through Chrome (needs the access above). */
export async function readLocalFile(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't read the file.");
  const blob = await res.blob();
  return new File([blob], fileNameOf(url), { type: blob.type, lastModified: Date.now() });
}
