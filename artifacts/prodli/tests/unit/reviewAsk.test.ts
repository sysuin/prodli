import { describe, expect, it } from "vitest";
import { answerReviewAsk, NO_REVIEW_ASK, shouldAskForReview } from "../../src/lib/reviewAsk";

const DAY = 86_400_000;

describe("asking for a store review", () => {
  it("waits for three summarized meetings", () => {
    expect(shouldAskForReview(2, null, 0)).toBe(false);
    expect(shouldAskForReview(3, null, 0)).toBe(true);
    expect(shouldAskForReview(3, NO_REVIEW_ASK, 0)).toBe(true);
  });

  it("asks again two weeks after Not now, and at most twice", () => {
    const later = answerReviewAsk(null, "later", 0);
    expect(later).toEqual({ status: "later", asks: 1, at: 0 });
    expect(shouldAskForReview(5, later, 13 * DAY)).toBe(false);
    expect(shouldAskForReview(5, later, 14 * DAY)).toBe(true);
    const again = answerReviewAsk(later, "later", 14 * DAY);
    expect(shouldAskForReview(9, again, 60 * DAY)).toBe(false);
  });

  it("stops after a review or Don't ask again", () => {
    expect(shouldAskForReview(9, answerReviewAsk(null, "review", 0), 90 * DAY)).toBe(false);
    expect(shouldAskForReview(9, answerReviewAsk(null, "never", 0), 90 * DAY)).toBe(false);
  });
});
