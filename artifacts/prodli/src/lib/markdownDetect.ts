// Tiny, dependency-free helpers the Editor needs on every paste. The heavy
// Markdown converter (marked + DOMPurify) loads only when it's actually used.

/** Heuristic: does pasted plain text look like Markdown worth converting? */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.includes("\n")) return /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(text);
  return /^(#{1,6}\s|\s*[-*+]\s\[[ xX]\]\s|\s*[-*+]\s|\s*\d+\.\s|>\s|```|\|.+\|)/m.test(text);
}

/** Notes live in chrome.storage.local; keep imports reasonably small. */
export const MAX_NOTE_BYTES = 1024 * 1024;
