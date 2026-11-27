import { describe, expect, it } from "vitest";
import { DomainSet } from "../../src/lib/domainSet";

describe("DomainSet (excluded sites)", () => {
  it("covers the site and its subdomains, not look-alikes", () => {
    const s = new DomainSet(["Google.com", "www.bank.example", " "]);
    expect(s.has("google.com")).toBe(true);
    expect(s.has("mail.google.com")).toBe(true);
    expect(s.has("MAIL.GOOGLE.COM")).toBe(true);
    expect(s.has("bank.example")).toBe(true);
    expect(s.has("notgoogle.com")).toBe(false);
    expect(s.has("google.co")).toBe(false);
    expect(s.size).toBe(2);
  });
});
