// Learning words you correct right after dictating (a misheard name, say).
// Only the injected pill imports this, so it bundles inside dictate-pill.js.

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;
const words = (t: string) => t.match(WORD) ?? [];

/**
 * Words you corrected in what was just dictated (Wispr Flow-style "learn
 * words"). `before` is the field right after the dictation was typed, `after`
 * is it now, and [start, end) is where the dictation went in `before`. A word
 * counts as a correction when it replaced a similar-looking dictated word
 * (a misheard name, a brand's spelling), not a rewrite or a new sentence.
 */
export function correctedWords(before: string, after: string, start: number, end: number): string[] {
  if (before === after) return [];
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let q = 0;
  while (q < before.length - p && q < after.length - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
  // Widen the change to whole words.
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}'’.-]/u.test(c);
  let a0 = p;
  while (a0 > 0 && isWordChar(before[a0 - 1])) a0--;
  let a1 = before.length - q;
  while (a1 < before.length && isWordChar(before[a1])) a1++;
  const b1 = after.length - (before.length - a1);
  // Only changes inside the dictated text.
  if (a0 < start - 1 || a1 > end + 1) return [];
  const old = words(before.slice(a0, a1));
  const now = words(after.slice(a0, b1));
  if (!old.length || old.length !== now.length || old.length > 4) return [];
  const out: string[] = [];
  for (let i = 0; i < old.length; i++) {
    const o: string = old[i];
    const n: string = now[i];
    if (o === n || n.length < 3) continue;
    const lo = o.toLowerCase();
    const ln = n.toLowerCase();
    // Only the capitals changed: learn it when they're inside the word (iPhone, ProdLi), not a sentence's first letter.
    if (lo === ln) {
      if (/[A-Z]/.test(n.slice(1))) out.push(n);
      continue;
    }
    if (editDistance(lo, ln) <= Math.max(2, Math.ceil(Math.max(o.length, n.length) / 3))) out.push(n);
  }
  return out;
}
