import { describe, expect, it } from "vitest";
import { pendingUpgradeFresh, tierOf, yearlySaving } from "../../src/lib/billing";

describe("plans", () => {
  it("yearly saving against twelve monthly payments", () => {
    expect(yearlySaving({ onSale: { monthly: true, yearly: true }, prices: { monthly: { amount: 500, currency: "USD" }, yearly: { amount: 4800, currency: "USD" } } })).toBe(20);
    expect(yearlySaving({ onSale: { monthly: true, yearly: true }, prices: { monthly: { amount: 1200, currency: "USD" }, yearly: { amount: 12000, currency: "USD" } } })).toBe(17);
    expect(yearlySaving({ onSale: { monthly: true, yearly: false }, prices: { monthly: { amount: 500, currency: "USD" } } })).toBeNull();
    expect(yearlySaving({ onSale: { monthly: true, yearly: true }, prices: { monthly: { amount: 500, currency: "USD" }, yearly: { amount: 4800, currency: "INR" } } })).toBeNull();
  });
  it("the exact plan, from new and old servers", () => {
    expect(tierOf({ plan: "pro", tier: "plus" })).toBe("plus");
    expect(tierOf({ plan: "pro" })).toBe("pro");
    expect(tierOf({ plan: "free" })).toBe("free");
  });
  it("a plan picked before signing in is used only for a few minutes", () => {
    const now = 1_000_000_000;
    expect(pendingUpgradeFresh({ plan: "plus", interval: "yearly", at: now - 60_000 }, now)).toBe(true);
    expect(pendingUpgradeFresh({ plan: "plus", interval: "yearly", at: now - 16 * 60_000 }, now)).toBe(false);
    expect(pendingUpgradeFresh({ plan: "max" as never, interval: "yearly", at: now }, now)).toBe(false);
    expect(pendingUpgradeFresh(null, now)).toBe(false);
  });
});
