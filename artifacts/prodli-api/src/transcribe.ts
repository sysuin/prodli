// Audio transcription for meetings where people switch languages (Meet's
// captions follow one language). The app cuts the meeting's recording into
// ~30-second 16 kHz mono WAV pieces and sends them one at a time; each piece is
// transcribed by Whisper on Cloudflare Workers AI, which detects the language
// itself. Nothing is stored here except the monthly seconds (D1 transcribe_usage).

import { AiError, monthKey } from "./ai";

/** Minutes of audio per month. Workers AI gives ~214 free minutes a day per account; beyond that it's ~$0.03 an hour. */
export const TRANSCRIBE_MONTHLY_MINUTES = { free: 300, pro: 1500 } as const;
export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
/** One piece: the app sends ≤ 30 s; a little slack for rounding. */
export const MAX_PIECE_SECONDS = 35;
const SAMPLE_RATE = 16_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
export const MAX_PIECE_BYTES = 44 + MAX_PIECE_SECONDS * BYTES_PER_SECOND;

/** Seconds of audio in a 16 kHz, mono, 16-bit PCM WAV, or null if it isn't one. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") return null;
  const format = v.getUint16(20, true);
  const channels = v.getUint16(22, true);
  const rate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  if (format !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16 || tag(36) !== "data") return null;
  const dataBytes = Math.min(v.getUint32(40, true), bytes.length - 44);
  return dataBytes / BYTES_PER_SECOND;
}

export interface TranscriptPiece {
  text: string;
  /** Seconds from the start of the piece. */
  segments: { start: number; end: number; text: string }[];
  language: string | null;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface WhisperOutput {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
  transcription_info?: { language?: string };
}

export async function transcribeWithWorkersAi(wav: Uint8Array, ai: Ai): Promise<TranscriptPiece> {
  try {
    const out = (await ai.run(TRANSCRIBE_MODEL as Parameters<Ai["run"]>[0], {
      audio: toBase64(wav),
      task: "transcribe",
      vad_filter: true,
      // Repeated phrases on quiet audio are a known Whisper failure; don't let one piece feed the next.
      condition_on_previous_text: false,
    } as never)) as WhisperOutput;
    const segments = (out.segments ?? [])
      .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: (s.text ?? "").trim() }))
      .filter((s) => s.text);
    return { text: (out.text ?? "").trim(), segments, language: out.transcription_info?.language ?? null };
  } catch (err) {
    console.error(JSON.stringify({ msg: "transcribe_error", type: err instanceof Error ? err.name : "unknown", detail: err instanceof Error ? err.message.slice(0, 120) : "" }));
    throw new AiError("ai_busy", "Transcription is busy right now. Try again in a minute.");
  }
}

export async function transcribeUsage(db: D1Database, userId: string, now: number): Promise<number> {
  const row = await db.prepare(`SELECT seconds FROM transcribe_usage WHERE user_id = ?1 AND month = ?2`).bind(userId, monthKey(now)).first<{ seconds: number }>();
  return row?.seconds ?? 0;
}

/** Reserves `seconds` if they fit under `limitSeconds`. Returns the new total, or null when they don't fit. */
export async function reserveSeconds(db: D1Database, userId: string, now: number, seconds: number, limitSeconds: number): Promise<number | null> {
  if (seconds > limitSeconds) return null;
  const row = await db
    .prepare(
      `INSERT INTO transcribe_usage (user_id, month, seconds) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, month) DO UPDATE SET seconds = seconds + ?3 WHERE seconds + ?3 <= ?4
       RETURNING seconds`,
    )
    .bind(userId, monthKey(now), seconds, limitSeconds)
    .first<{ seconds: number }>();
  return row?.seconds ?? null;
}

export async function refundSeconds(db: D1Database, userId: string, now: number, seconds: number): Promise<void> {
  await db.prepare(`UPDATE transcribe_usage SET seconds = MAX(seconds - ?3, 0) WHERE user_id = ?1 AND month = ?2`).bind(userId, monthKey(now), seconds).run();
}
