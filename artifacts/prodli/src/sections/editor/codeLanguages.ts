// Languages offered by a code block's picker. The ids are highlight.js/lowlight
// names (or aliases) and become the Markdown fence: ```python.

export interface CodeLanguage {
  /** The code block's `language` attribute; null = detect automatically. */
  id: string | null;
  label: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: null, label: "Auto-detect" },
  { id: "text", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "bash", label: "Bash / Shell" },
  { id: "sql", label: "SQL" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "swift", label: "Swift" },
  { id: "kotlin", label: "Kotlin" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
];

/** Other names people put on fences (```js, ```sh …) → the picker's id. */
const ALIASES: Record<string, string> = {
  plaintext: "text", txt: "text", plain: "text",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", python3: "python",
  htm: "html", xhtml: "html",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  golang: "go", rs: "rust",
  "c++": "cpp", cc: "cpp", hpp: "cpp", h: "c",
  cs: "csharp", "c#": "csharp",
  rb: "ruby", kt: "kotlin", kts: "kotlin",
  yml: "yaml", md: "markdown", mkd: "markdown",
};

/** The picker id for a block's `language` attribute (unknown names are kept as they are). */
export function pickerLanguage(language: string | null | undefined): string | null {
  const l = (language ?? "").trim().toLowerCase();
  if (!l) return null;
  return ALIASES[l] ?? l;
}
