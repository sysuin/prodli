// "Is ProdLi useful? A review helps others find it." Shown in Meetings once a
// person has three summarized meetings, so the ask comes after ProdLi has
// clearly helped. Asked at most twice: "Not now" waits two weeks; "Leave a
// review" or "Don't ask again" ends it. Extension only (the review is for the
// Chrome Web Store listing).

export const REVIEW_ASK_KEY = "reviewAsk";
export const CHROME_STORE_REVIEWS_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp/reviews";

export const REVIEW_AFTER_SUMMARIES = 3;
const WAIT_AFTER_LATER_MS = 14 * 86_400_000;
const MAX_ASKS = 2;

export type ReviewAskState = { status: "none" | "later" | "done"; asks: number; at: number };
export const NO_REVIEW_ASK: ReviewAskState = { status: "none", asks: 0, at: 0 };

export function shouldAskForReview(summarized: number, state: ReviewAskState | null | undefined, now: number): boolean {
  const s = state ?? NO_REVIEW_ASK;
  if (summarized < REVIEW_AFTER_SUMMARIES || s.status === "done" || s.asks >= MAX_ASKS) return false;
  return s.status === "none" || now - s.at >= WAIT_AFTER_LATER_MS;
}

/** The state after the person answers: "review" or "never" ends it, "later" waits. */
export function answerReviewAsk(state: ReviewAskState | null | undefined, answer: "review" | "later" | "never", now: number): ReviewAskState {
  const asks = (state?.asks ?? 0) + 1;
  return { status: answer === "later" ? "later" : "done", asks, at: now };
}
