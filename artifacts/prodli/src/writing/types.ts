// Writing check: shared shapes. The checker runs in the page you're typing in
// (writing/checker.ts, injected like dictation); the extension's background
// (writing/background.ts) holds the account and calls ProdLi's AI when Chrome's
// on-device model isn't there. Plan: docs/PLAN-WRITING-CHECK.md.
//
// Types only: the in-page checker is bundled on its own (injected scripts can't
// import shared chunks), so runtime constants live in constants.ts, which only
// the checker imports, and settings.ts for the rest of the extension.

export type IssueType = "spelling" | "grammar" | "punctuation" | "word_choice" | "clarity" | "tone";

/** One suggestion in one paragraph (offsets into that paragraph's text). */
export interface CheckIssue {
  start: number;
  end: number;
  original: string;
  replacement: string;
  type: IssueType;
  explanation: string;
}

export type EnglishVariant = "en-US" | "en-GB" | "en-IN" | "en-AU" | "en-CA";
export type CheckLevel = "correct" | "polish";

export interface WritingSettings {
  /** "correct": only mistakes. "polish": also clearer wording and tone. */
  level: CheckLevel;
  /** Spelling conventions for English. Missing: let the checker decide. */
  variant?: EnglishVariant;
  /** Use Chrome's on-device model when it's downloaded (free, private, unlimited). */
  onDevice: boolean;
  /** Check every site automatically (needs the optional all-sites permission). */
  everywhere: boolean;
  /** Sites where it never runs (host names). */
  offSites: string[];
  /** Words never flagged (names, jargon). */
  dictionary: string[];
}

export type CheckError = "signed_out" | "quota" | "offline" | "busy" | "unavailable";

// ── Messages (page ↔ background) ─────────────────────────────────────────────

export type ToWritingBackground =
  | { target: "writing-bg"; type: "check"; paragraphs: string[]; level: CheckLevel; variant?: EnglishVariant }
  | { target: "writing-bg"; type: "rewrite"; text: string; action: RewriteAction }
  | { target: "writing-bg"; type: "settings" }
  | { target: "writing-bg"; type: "add-word"; word: string }
  | { target: "writing-bg"; type: "site-off"; host: string }
  | { target: "writing-bg"; type: "open-settings" };

export type CheckReply = { ok: true; issues: CheckIssue[][]; used?: number; limit?: number } | { ok: false; error: CheckError; message: string };
export type RewriteReply = { ok: true; text: string; changed: boolean } | { ok: false; error: CheckError; message: string };

export type RewriteAction = "shorter" | "clearer" | "formal" | "friendly";

export type ToWritingPage = { target: "writing-page"; type: "start" } | { target: "writing-page"; type: "stop" };
